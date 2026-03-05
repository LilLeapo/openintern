import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";

import type {
  SubagentApprovalCancelledEvent,
  SubagentApprovalExpiredEvent,
  SubagentApprovalGrantedEvent,
  SubagentApprovalRequestedEvent,
  SubagentTaskMessage,
  SubagentTaskEvent,
  SubagentTaskToolCall,
} from "../bus/events.js";
import { MessageBus } from "../bus/message-bus.js";
import {
  WorkflowEngine,
  type StartWorkflowOptions,
  type WorkflowApprovalSnapshot,
  type WorkflowRunHandle,
  type WorkflowRunSnapshot,
} from "../workflow/engine.js";
import { RuntimeSqliteStore } from "../workflow/runtime-sqlite.js";

interface StartRuntimeWorkflowInput {
  definition: unknown;
  triggerInput?: Record<string, unknown>;
  originChannel?: string;
  originChatId?: string;
}

interface RuntimeTraceInput {
  runId: string;
  type: string;
  title: string;
  details: string;
  status: "ok" | "pending" | "failed";
  meta?: Record<string, unknown>;
}

export interface RuntimeRunActivity {
  id: string;
  runId: string;
  nodeId: string | null;
  taskId: string;
  role: string | null;
  label: string;
  task: string;
  status: "ok" | "error";
  result: string;
  type: "subagent.task.completed" | "subagent.task.failed";
  timestamp: string;
  messages: SubagentTaskMessage[];
  toolCalls: SubagentTaskToolCall[];
}

interface RuntimeMockApprovalInput {
  runId?: string;
  workflowId?: string;
  nodeId?: string;
  nodeName?: string;
  approvalTarget?: "owner" | "group";
  toolCalls?: Array<{
    id?: string;
    name: string;
    arguments?: Record<string, unknown>;
    highRisk?: boolean;
  }>;
  commandPreview?: string;
  expiresInMs?: number;
}

export interface RuntimeTraceEvent extends RuntimeTraceInput {
  id: string;
  timestamp: string;
}

export interface RuntimeEventEnvelope {
  eventId: string;
  seq: number;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const MAX_TRACES = 500;
const MAX_TERMINAL_RUNS = 200;
const MAX_RUN_ACTIVITIES = 200;

function shortTraceText(value: string | null | undefined, max = 260): string {
  if (!value) {
    return "";
  }
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) {
    return "";
  }
  if (clean.length <= max) {
    return clean;
  }
  return `${clean.slice(0, max - 3)}...`;
}

function parseOriginContext(event: SubagentTaskEvent): { runId: string; nodeId: string | null } | null {
  if (event.originChannel !== "workflow") {
    return null;
  }
  const origin = event.originChatId ?? "";
  const idx = origin.indexOf(":");
  if (idx <= 0) {
    return null;
  }
  const runId = origin.slice(0, idx).trim();
  if (!runId) {
    return null;
  }
  const nodeId = origin.slice(idx + 1).trim() || null;
  return {
    runId,
    nodeId,
  };
}

export class UiRuntimeState {
  private readonly bus: MessageBus;
  private readonly engine: WorkflowEngine;
  private readonly store?: RuntimeSqliteStore;
  private readonly sseClients = new Set<ServerResponse>();
  private readonly unsubscribers: Array<() => void>;
  private readonly runHandles = new Map<string, WorkflowRunHandle>();
  private readonly runs = new Map<string, WorkflowRunSnapshot>();
  private readonly runActivities = new Map<string, RuntimeRunActivity[]>();
  private readonly mockApprovals = new Map<string, WorkflowApprovalSnapshot>();
  private traces: RuntimeTraceEvent[] = [];
  private seq = 0;
  private readonly pollTimer: NodeJS.Timeout;

  constructor(options: { bus: MessageBus; engine: WorkflowEngine; store?: RuntimeSqliteStore }) {
    this.bus = options.bus;
    this.engine = options.engine;
    this.store = options.store;

    this.unsubscribers = [
      this.bus.onSubagentEvent(async (event) => {
        await this.onSubagentEvent(event);
      }),
      this.bus.onSubagentApprovalRequested(async (event) => {
        await this.onApprovalRequested(event);
      }),
      this.bus.onSubagentApprovalGranted(async (event) => {
        await this.onApprovalGranted(event);
      }),
      this.bus.onSubagentApprovalExpired(async (event) => {
        await this.onApprovalExpired(event);
      }),
      this.bus.onSubagentApprovalCancelled(async (event) => {
        await this.onApprovalCancelled(event);
      }),
    ];

    this.pollTimer = setInterval(() => {
      void this.pollRuns();
    }, 1_000);
  }

  close(): void {
    clearInterval(this.pollTimer);
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();
  }

  attachApprovalStream(res: ServerResponse): void {
    this.attachEventStream(res);
  }

  attachEventStream(res: ServerResponse): void {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.write("retry: 1500\n\n");

    this.sseClients.add(res);
    this.sendEnvelopeTo(
      res,
      this.nextEnvelope("stream.connected", {
        now: new Date().toISOString(),
      }),
    );

    res.on("close", () => {
      this.sseClients.delete(res);
    });
  }

  listApprovals(options?: { pendingOnly?: boolean }): WorkflowApprovalSnapshot[] {
    const liveRows = this.currentApprovals();
    const persistedRows = this.store ? this.store.listApprovals() : [];
    const byId = new Map<string, WorkflowApprovalSnapshot>();
    for (const row of persistedRows) {
      byId.set(row.approvalId, row);
    }
    for (const row of liveRows) {
      byId.set(row.approvalId, row);
    }
    const rows = Array.from(byId.values()).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    if (options?.pendingOnly) {
      return rows.filter((row) => row.status === "pending");
    }
    return rows;
  }

  listRuns(options?: { limit?: number }): WorkflowRunSnapshot[] {
    const liveRows = Array.from(this.runs.values())
      .map((run) => this.applyMockApprovals(run))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const persistedRows = this.store ? this.store.listRuns() : [];
    const byId = new Map<string, WorkflowRunSnapshot>();
    for (const row of persistedRows) {
      byId.set(row.runId, row);
    }
    for (const row of liveRows) {
      byId.set(row.runId, row);
    }
    const rows = Array.from(byId.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const limit = options?.limit;
    if (!limit || limit <= 0) {
      return rows;
    }
    return rows.slice(0, limit);
  }

  listTraces(options?: { runId?: string; limit?: number }): RuntimeTraceEvent[] {
    const runId = options?.runId?.trim() || undefined;
    const persistedRows = this.store ? this.store.listTraces({ runId }) : [];
    const byId = new Map<string, RuntimeTraceEvent>();
    for (const row of persistedRows) {
      byId.set(row.id, row);
    }
    for (const row of this.traces) {
      if (runId && row.runId !== runId) {
        continue;
      }
      byId.set(row.id, row);
    }
    const filtered = Array.from(byId.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const limit = options?.limit;
    if (!limit || limit <= 0) {
      return filtered;
    }
    return filtered.slice(0, limit);
  }

  listRunActivities(options: { runId: string; limit?: number }): RuntimeRunActivity[] {
    const runId = options.runId.trim();
    if (!runId) {
      return [];
    }
    const persistedRows = this.store ? this.store.listActivities({ runId }) : [];
    const byId = new Map<string, RuntimeRunActivity>();
    for (const row of persistedRows) {
      byId.set(row.id, row);
    }
    for (const row of this.runActivities.get(runId) ?? []) {
      byId.set(row.id, row);
    }
    const rows = Array.from(byId.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const limit = options.limit;
    if (!limit || limit <= 0) {
      return rows;
    }
    return rows.slice(0, limit);
  }

  async approve(approvalId: string, approver: string): Promise<void> {
    const pending = this.engine
      .getApprovals({ pendingOnly: true })
      .find((approval) => approval.approvalId === approvalId);
    if (pending) {
      await this.bus.emitSubagentApprovalGranted({
        type: "SUBAGENT_APPROVAL_GRANTED",
        approvalId,
        taskId: pending.taskId,
        approver,
        approvedAt: new Date(),
      });
      return;
    }

    const mock = this.mockApprovals.get(approvalId);
    if (!mock || mock.status !== "pending") {
      throw new Error("Approval not found or already resolved.");
    }

    const approvedAt = new Date().toISOString();
    this.mockApprovals.set(approvalId, {
      ...mock,
      status: "approved",
      approvedAt,
      approver,
      reason: null,
    });
    this.persistApprovals();

    this.broadcast(
      this.nextEnvelope("approval.updated", {
        subtype: "granted",
        event: {
          approvalId,
          taskId: mock.taskId,
          approver,
          approvedAt,
        },
      }),
    );

    this.pushTrace({
      runId: mock.runId,
      type: "approval.granted",
      title: "Approval granted",
      details: `approvalId=${approvalId}; approver=${approver}`,
      status: "ok",
      meta: {
        approvalId,
      },
    });

    const run = this.runs.get(mock.runId);
    if (run && run.originChannel === "ui-test") {
      const hasPending = this.listApprovals({ pendingOnly: true }).some((item) => item.runId === run.runId);
      if (!hasPending) {
        const completedAt = new Date().toISOString();
        const completedNodes = run.nodes.map((node) => ({
          ...node,
          status: "completed" as const,
        }));
        const nextRun: WorkflowRunSnapshot = {
          ...run,
          status: "completed",
          endedAt: completedAt,
          nodes: completedNodes,
        };
        this.runs.set(run.runId, nextRun);
        this.persistRun(nextRun);
        this.broadcast(
          this.nextEnvelope("run.status.changed", {
            runId: run.runId,
            status: nextRun.status,
            run: this.applyMockApprovals(nextRun),
          }),
        );
      }
    }
  }

  async startWorkflow(input: StartRuntimeWorkflowInput): Promise<{ runId: string }> {
    const startOptions: StartWorkflowOptions = {
      triggerInput: input.triggerInput ?? {},
      originChannel: input.originChannel ?? "ui",
      originChatId: input.originChatId ?? "studio",
    };

    const handle = await this.engine.start(input.definition, startOptions);
    this.runHandles.set(handle.runId, handle);
    this.captureRunSnapshot(handle.runId);

    this.pushTrace({
      runId: handle.runId,
      type: "run.started",
      title: "Workflow run started",
      details: `runId=${handle.runId}`,
      status: "ok",
    });

    void handle.done.finally(() => {
      this.captureRunSnapshot(handle.runId);
      this.runHandles.delete(handle.runId);
    });

    return {
      runId: handle.runId,
    };
  }

  getRun(runId: string): WorkflowRunSnapshot | null {
    const cached = this.runs.get(runId);
    if (cached) {
      return this.applyMockApprovals(cached);
    }
    const snapshot = this.engine.getRunSnapshot(runId);
    if (!snapshot) {
      return null;
    }
    this.runs.set(runId, snapshot);
    this.persistRun(snapshot);
    return this.applyMockApprovals(snapshot);
  }

  createMockApproval(input: RuntimeMockApprovalInput): WorkflowApprovalSnapshot {
    const runId = input.runId?.trim() || `run_mock_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const workflowId = input.workflowId?.trim() || "wf_mock_approval";
    const nodeId = input.nodeId?.trim() || "node_mock_approval";
    const nodeName = input.nodeName?.trim() || "Mock Approval Node";
    const approvalId = `ap_mock_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const taskId = `task_mock_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const requestedAt = new Date();
    const expiresAt = new Date(
      requestedAt.getTime() + Math.max(5_000, input.expiresInMs ?? 10 * 60 * 1000),
    );
    const toolCalls =
      input.toolCalls && input.toolCalls.length > 0
        ? input.toolCalls.map((toolCall, index) => ({
            id: toolCall.id?.trim() || `tool_mock_${index + 1}`,
            name: toolCall.name.trim() || "exec",
            arguments: toolCall.arguments ?? {},
            highRisk: toolCall.highRisk !== false,
          }))
        : [
            {
              id: "tool_mock_1",
              name: "exec",
              arguments: {
                command: "echo mock approval",
              },
              highRisk: true,
            },
          ];

    const approval: WorkflowApprovalSnapshot = {
      runId,
      workflowId,
      approvalId,
      taskId,
      nodeId,
      nodeName,
      status: "pending",
      approvalTarget: input.approvalTarget === "group" ? "group" : "owner",
      requestedAt: requestedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      approvedAt: null,
      approver: null,
      commandPreview: input.commandPreview?.trim() || `Pending review for ${toolCalls[0]?.name ?? "tool"}.`,
      toolCalls,
      reason: null,
    };

    const currentRun = this.runs.get(runId);
    if (!currentRun) {
      const syntheticRun: WorkflowRunSnapshot = {
        runId,
        workflowId,
        status: "waiting_for_approval",
        startedAt: requestedAt.toISOString(),
        endedAt: null,
        error: null,
        execution: {
          mode: "serial",
          maxParallel: 1,
        },
        triggerInput: {},
        originChannel: "ui-test",
        originChatId: "mock-approval",
        activeTaskIds: [taskId],
        outputs: {},
        approvals: [],
        nodes: [
          {
            id: nodeId,
            name: nodeName,
            status: "waiting_for_approval",
            attempt: 1,
            maxAttempts: 1,
            currentTaskId: taskId,
            lastError: null,
          },
        ],
      };
      this.runs.set(runId, syntheticRun);
      this.persistRun(syntheticRun);
    }

    this.mockApprovals.set(approvalId, approval);
    this.persistApprovals();
    const nextRun = this.getRun(runId);
    if (nextRun) {
      this.broadcast(
        this.nextEnvelope("run.status.changed", {
          runId,
          status: nextRun.status,
          run: nextRun,
        }),
      );
    }

    this.broadcast(
      this.nextEnvelope("approval.requested", {
        event: {
          approvalId,
          taskId,
          runId,
          nodeId,
          nodeName,
          approvalTarget: approval.approvalTarget,
          requestedAt: approval.requestedAt,
          expiresAt: approval.expiresAt,
          toolCalls: approval.toolCalls,
          commandPreview: approval.commandPreview,
          originChannel: "ui",
          originChatId: "studio",
        },
      }),
    );

    this.pushTrace({
      runId,
      type: "approval.requested",
      title: "Approval requested",
      details: `approvalId=${approvalId}; nodeId=${nodeId}; target=${approval.approvalTarget}`,
      status: "pending",
      meta: {
        approvalId,
        taskId,
      },
    });

    return approval;
  }

  async cancelRun(runId: string): Promise<void> {
    await this.engine.cancel(runId);
    this.captureRunSnapshot(runId);
  }

  private async pollRuns(): Promise<void> {
    for (const runId of this.runHandles.keys()) {
      this.captureRunSnapshot(runId);
    }
  }

  private captureRunSnapshot(runId: string): void {
    const next = this.engine.getRunSnapshot(runId);
    if (!next) {
      return;
    }

    const prev = this.runs.get(runId) ?? null;
    this.runs.set(runId, next);
    const nextWithMock = this.applyMockApprovals(next);
    this.persistRun(nextWithMock);

    if (!prev || prev.status !== next.status) {
      const statusDetails =
        next.status === "failed" && next.error
          ? `${prev ? `${prev.status} -> ${next.status}` : `status=${next.status}`}; error=${shortTraceText(next.error)}`
          : prev
            ? `${prev.status} -> ${next.status}`
            : `status=${next.status}`;
      this.broadcast(
        this.nextEnvelope("run.status.changed", {
          runId,
          status: next.status,
          run: nextWithMock,
        }),
      );
      this.pushTrace({
        runId,
        type: "run.status.changed",
        title: "Run status changed",
        details: statusDetails,
        status:
          next.status === "failed"
            ? "failed"
            : next.status === "waiting_for_approval"
              ? "pending"
              : "ok",
      });
    }

    const prevNodeById = new Map((prev?.nodes ?? []).map((node) => [node.id, node]));
    for (const node of next.nodes) {
      const prevNode = prevNodeById.get(node.id);
      if (
        !prevNode ||
        prevNode.status !== node.status ||
        prevNode.attempt !== node.attempt ||
        prevNode.currentTaskId !== node.currentTaskId
      ) {
        const nodeDetailsBase = prevNode
          ? `${prevNode.status} -> ${node.status} (attempt ${node.attempt}/${node.maxAttempts})`
          : `${node.status} (attempt ${node.attempt}/${node.maxAttempts})`;
        const nodeDetails =
          node.status === "failed" && node.lastError
            ? `${nodeDetailsBase}; error=${shortTraceText(node.lastError)}`
            : nodeDetailsBase;
        this.broadcast(
          this.nextEnvelope("node.status.changed", {
            runId,
            node,
          }),
        );
        this.pushTrace({
          runId,
          type: "node.status.changed",
          title: `Node ${node.id} status changed`,
          details: nodeDetails,
          status: node.status === "failed" ? "failed" : node.status === "waiting_for_approval" ? "pending" : "ok",
          meta: {
            nodeId: node.id,
            ...(node.lastError ? { error: shortTraceText(node.lastError) } : {}),
          },
        });
      }
    }

    this.pruneTerminalRuns();
  }

  private pruneTerminalRuns(): void {
    const rows = Array.from(this.runs.values())
      .map((run) => this.applyMockApprovals(run))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const active = rows.filter((run) => run.status === "running" || run.status === "waiting_for_approval");
    const terminal = rows.filter((run) => run.status !== "running" && run.status !== "waiting_for_approval");
    const keptTerminal = terminal.slice(0, MAX_TERMINAL_RUNS);

    const keptIds = new Set([...active, ...keptTerminal].map((run) => run.runId));
    for (const runId of this.runs.keys()) {
      if (!keptIds.has(runId)) {
        this.runs.delete(runId);
        this.runActivities.delete(runId);
        for (const approval of Array.from(this.mockApprovals.values())) {
          if (approval.runId === runId) {
            this.mockApprovals.delete(approval.approvalId);
          }
        }
      }
    }
  }

  private async onSubagentEvent(event: SubagentTaskEvent): Promise<void> {
    const origin = parseOriginContext(event);
    const activity = origin
      ? this.pushRunActivity(origin.runId, {
          id: `activity_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
          runId: origin.runId,
          nodeId: origin.nodeId,
          taskId: event.taskId,
          role: event.role,
          label: event.label,
          task: event.task,
          status: event.status,
          result: event.result,
          type: event.type === "SUBAGENT_TASK_COMPLETED" ? "subagent.task.completed" : "subagent.task.failed",
          timestamp: event.timestamp.toISOString(),
          messages: event.messages ?? [],
          toolCalls: event.toolCalls ?? [],
        })
      : null;

    const serializedEvent = {
      ...event,
      timestamp: event.timestamp.toISOString(),
    };
    this.broadcast(
      this.nextEnvelope(
        event.type === "SUBAGENT_TASK_COMPLETED" ? "subagent.task.completed" : "subagent.task.failed",
        {
          event: serializedEvent,
          runId: origin?.runId ?? null,
          activity,
        },
      ),
    );

    if (!origin) {
      return;
    }
    const runId = origin.runId;

    if (activity) {
      this.broadcast(
        this.nextEnvelope("run.activity.append", {
          runId,
          activity,
        }),
      );
    }

    const toolNames = event.toolCalls?.map((item) => item.name).filter((name) => name.trim().length > 0) ?? [];
    const failureText =
      event.type === "SUBAGENT_TASK_FAILED" || event.status === "error"
        ? shortTraceText(event.result)
        : "";
    const detailParts = [`taskId=${event.taskId}`, `label=${event.label}`];
    if (toolNames.length > 0) {
      detailParts.push(`tools=${toolNames.join(", ")}`);
    }
    if (failureText) {
      detailParts.push(`error=${failureText}`);
    }
    this.pushTrace({
      runId,
      type: event.type === "SUBAGENT_TASK_COMPLETED" ? "subagent.task.completed" : "subagent.task.failed",
      title: `Subagent task ${event.type === "SUBAGENT_TASK_COMPLETED" ? "completed" : "failed"}`,
      details: detailParts.join("; "),
      status: event.type === "SUBAGENT_TASK_COMPLETED" ? "ok" : "failed",
      meta: {
        taskId: event.taskId,
        nodeOrigin: event.originChatId,
        ...(failureText ? { error: failureText } : {}),
      },
    });

    this.captureRunSnapshot(runId);
  }

  private async onApprovalRequested(event: SubagentApprovalRequestedEvent): Promise<void> {
    const serialized = this.serializeApprovalRequestedEvent(event);
    this.broadcast(
      this.nextEnvelope("approval.requested", {
        event: serialized,
      }),
    );

    this.pushTrace({
      runId: event.runId,
      type: "approval.requested",
      title: "Approval requested",
      details: `approvalId=${event.approvalId}; nodeId=${event.nodeId}; target=${event.approvalTarget}`,
      status: "pending",
      meta: {
        approvalId: event.approvalId,
        taskId: event.taskId,
      },
    });
    this.captureRunSnapshot(event.runId);
    this.persistApprovals();
  }

  private async onApprovalGranted(event: SubagentApprovalGrantedEvent): Promise<void> {
    const runId = this.runIdByApproval(event.approvalId);
    this.broadcast(
      this.nextEnvelope("approval.updated", {
        subtype: "granted",
        event: this.serializeApprovalGrantedEvent(event),
      }),
    );

    if (runId) {
      this.pushTrace({
        runId,
        type: "approval.granted",
        title: "Approval granted",
        details: `approvalId=${event.approvalId}; approver=${event.approver}`,
        status: "ok",
        meta: {
          approvalId: event.approvalId,
        },
      });
      this.captureRunSnapshot(runId);
      this.persistApprovals();
    }
  }

  private async onApprovalExpired(event: SubagentApprovalExpiredEvent): Promise<void> {
    const runId = this.runIdByApproval(event.approvalId);
    this.broadcast(
      this.nextEnvelope("approval.updated", {
        subtype: "expired",
        event: this.serializeApprovalExpiredEvent(event),
      }),
    );

    if (runId) {
      this.pushTrace({
        runId,
        type: "approval.expired",
        title: "Approval expired",
        details: `approvalId=${event.approvalId}; reason=${event.reason}`,
        status: "failed",
        meta: {
          approvalId: event.approvalId,
        },
      });
      this.captureRunSnapshot(runId);
      this.persistApprovals();
    }
  }

  private async onApprovalCancelled(event: SubagentApprovalCancelledEvent): Promise<void> {
    const runId = this.runIdByApproval(event.approvalId);
    this.broadcast(
      this.nextEnvelope("approval.updated", {
        subtype: "cancelled",
        event: this.serializeApprovalCancelledEvent(event),
      }),
    );

    if (runId) {
      this.pushTrace({
        runId,
        type: "approval.cancelled",
        title: "Approval cancelled",
        details: `approvalId=${event.approvalId}; reason=${event.reason}`,
        status: "failed",
        meta: {
          approvalId: event.approvalId,
        },
      });
      this.captureRunSnapshot(runId);
      this.persistApprovals();
    }
  }

  private pushRunActivity(runId: string, activity: RuntimeRunActivity): RuntimeRunActivity {
    const current = this.runActivities.get(runId) ?? [];
    const next = [activity, ...current.filter((item) => item.id !== activity.id)].slice(0, MAX_RUN_ACTIVITIES);
    this.runActivities.set(runId, next);
    this.persistActivity(activity);
    return activity;
  }

  private runIdByApproval(approvalId: string): string | null {
    const approval = this.listApprovals().find((item) => item.approvalId === approvalId);
    return approval?.runId ?? null;
  }

  private applyMockApprovals(run: WorkflowRunSnapshot): WorkflowRunSnapshot {
    const mockApprovals = Array.from(this.mockApprovals.values()).filter((item) => item.runId === run.runId);
    if (mockApprovals.length === 0) {
      return run;
    }

    const byId = new Map<string, WorkflowRunSnapshot["approvals"][number]>();
    for (const approval of run.approvals) {
      byId.set(approval.approvalId, approval);
    }
    for (const approval of mockApprovals) {
      byId.set(approval.approvalId, {
        approvalId: approval.approvalId,
        taskId: approval.taskId,
        nodeId: approval.nodeId,
        nodeName: approval.nodeName,
        status: approval.status,
        approvalTarget: approval.approvalTarget,
        requestedAt: approval.requestedAt,
        expiresAt: approval.expiresAt,
        approvedAt: approval.approvedAt,
        approver: approval.approver,
        commandPreview: approval.commandPreview,
        toolCalls: approval.toolCalls,
        reason: approval.reason,
      });
    }

    const approvals = Array.from(byId.values()).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    const hasPendingMock = mockApprovals.some((item) => item.status === "pending");
    const status =
      hasPendingMock && run.status !== "failed" && run.status !== "cancelled"
        ? "waiting_for_approval"
        : run.status;
    return {
      ...run,
      status,
      approvals,
    };
  }

  private currentApprovals(): WorkflowApprovalSnapshot[] {
    return [...this.engine.getApprovals(), ...this.mockApprovals.values()].sort((a, b) =>
      b.requestedAt.localeCompare(a.requestedAt),
    );
  }

  private persistRun(run: WorkflowRunSnapshot): void {
    if (!this.store) {
      return;
    }
    this.store.upsertRun(run);
  }

  private persistTrace(trace: RuntimeTraceEvent): void {
    if (!this.store) {
      return;
    }
    this.store.upsertTrace(trace);
  }

  private persistActivity(activity: RuntimeRunActivity): void {
    if (!this.store) {
      return;
    }
    this.store.upsertActivity(activity);
  }

  private persistApprovals(): void {
    if (!this.store) {
      return;
    }
    for (const approval of this.currentApprovals()) {
      this.store.upsertApproval(approval);
    }
  }

  private pushTrace(input: RuntimeTraceInput): void {
    const trace: RuntimeTraceEvent = {
      id: `trace_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      timestamp: new Date().toISOString(),
      ...input,
    };

    this.traces = [trace, ...this.traces.filter((item) => item.id !== trace.id)].slice(0, MAX_TRACES);
    this.persistTrace(trace);
    this.broadcast(
      this.nextEnvelope("trace.append", {
        trace,
      }),
    );
  }

  private nextEnvelope(type: string, data: Record<string, unknown>): RuntimeEventEnvelope {
    this.seq += 1;
    return {
      eventId: `evt_${this.seq}`,
      seq: this.seq,
      type,
      timestamp: new Date().toISOString(),
      data,
    };
  }

  private broadcast(payload: RuntimeEventEnvelope): void {
    if (this.sseClients.size === 0) {
      return;
    }

    for (const client of this.sseClients) {
      this.sendEnvelopeTo(client, payload);
    }
  }

  private sendEnvelopeTo(res: ServerResponse, payload: RuntimeEventEnvelope): void {
    res.write(`event: ${payload.type}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  private serializeApprovalRequestedEvent(event: SubagentApprovalRequestedEvent): Record<string, unknown> {
    return {
      ...event,
      requestedAt: event.requestedAt.toISOString(),
      expiresAt: event.expiresAt.toISOString(),
    };
  }

  private serializeApprovalGrantedEvent(event: SubagentApprovalGrantedEvent): Record<string, unknown> {
    return {
      ...event,
      approvedAt: event.approvedAt.toISOString(),
    };
  }

  private serializeApprovalExpiredEvent(event: SubagentApprovalExpiredEvent): Record<string, unknown> {
    return {
      ...event,
      expiredAt: event.expiredAt.toISOString(),
    };
  }

  private serializeApprovalCancelledEvent(event: SubagentApprovalCancelledEvent): Record<string, unknown> {
    return {
      ...event,
      cancelledAt: event.cancelledAt.toISOString(),
    };
  }
}
