import { randomUUID } from "node:crypto";

import type {
  SubagentApprovalCancelledEvent,
  SubagentApprovalExpiredEvent,
  SubagentApprovalGrantedEvent,
  SubagentApprovalRequestedEvent,
  SubagentTaskEvent,
} from "../bus/events.js";
import { MessageBus } from "../bus/message-bus.js";
import { validateRoleName } from "../config/role-resolver.js";
import type { AppConfig } from "../config/schema.js";
import { SkillsLoader } from "../agent/skills/loader.js";
import type {
  SpawnTaskOptions,
  SpawnTaskResult,
  SubagentManager,
} from "../agent/subagent/manager.js";
import type { WorkflowRunActivityRecord } from "./run-activity-history.js";
import { extractJsonObject, interpolateTemplate } from "./interpolation.js";
import {
  parseWorkflowDefinition,
  topologicalSort,
  type NormalizedWorkflowDefinition,
  type NormalizedWorkflowNodeDefinition,
} from "./schema.js";

export interface StartWorkflowOptions {
  triggerInput: Record<string, unknown>;
  originChannel: string;
  originChatId: string;
}

export interface WorkflowRunResult {
  runId: string;
  status: "completed" | "failed" | "cancelled";
  outputs: Record<string, Record<string, unknown>>;
  error?: string;
}

export interface WorkflowRunHandle {
  runId: string;
  done: Promise<WorkflowRunResult>;
}

export interface WorkflowRunSnapshot {
  runId: string;
  workflowId: string;
  status: "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  execution: {
    mode: "serial" | "parallel";
    maxParallel: number;
  };
  triggerInput: Record<string, unknown>;
  originChannel: string;
  originChatId: string;
  activeTaskIds: string[];
  outputs: Record<string, Record<string, unknown>>;
  approvals: Array<{
    approvalId: string;
    taskId: string;
    nodeId: string;
    nodeName: string;
    status: "pending" | "approved" | "expired" | "cancelled";
    approvalTarget: "owner" | "group";
    requestedAt: string;
    expiresAt: string;
    approvedAt: string | null;
    approver: string | null;
    commandPreview: string;
    toolCalls: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
      highRisk: boolean;
    }>;
    reason: string | null;
  }>;
  nodes: Array<{
    id: string;
    name?: string;
    status: "pending" | "running" | "waiting_for_approval" | "completed" | "failed";
    attempt: number;
    maxAttempts: number;
    currentTaskId: string | null;
    lastError: string | null;
  }>;
}

export interface WorkflowApprovalSnapshot {
  runId: string;
  workflowId: string;
  approvalId: string;
  taskId: string;
  nodeId: string;
  nodeName: string;
  status: "pending" | "approved" | "expired" | "cancelled";
  approvalTarget: "owner" | "group";
  requestedAt: string;
  expiresAt: string;
  approvedAt: string | null;
  approver: string | null;
  commandPreview: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    highRisk: boolean;
  }>;
  reason: string | null;
}

interface TrackedTask {
  runId: string;
  nodeId: string;
  attempt: number;
  sessionKey: string;
}

interface NodeRuntimeState {
  definition: NormalizedWorkflowNodeDefinition;
  status: "pending" | "running" | "waiting_for_approval" | "completed" | "failed";
  attempt: number;
  currentTaskId: string | null;
  lastError: string | null;
}

interface RunApprovalState {
  approvalId: string;
  taskId: string;
  nodeId: string;
  nodeName: string;
  status: "pending" | "approved" | "expired" | "cancelled";
  approvalTarget: "owner" | "group";
  requestedAt: Date;
  expiresAt: Date;
  approvedAt: Date | null;
  approver: string | null;
  commandPreview: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    highRisk: boolean;
  }>;
  reason: string | null;
}

interface RunRuntimeState {
  runId: string;
  definition: NormalizedWorkflowDefinition;
  status: "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
  startedAt: Date;
  endedAt: Date | null;
  error: string | null;
  triggerInput: Record<string, unknown>;
  originChannel: string;
  originChatId: string;
  topoOrder: string[];
  nodes: Map<string, NodeRuntimeState>;
  outputs: Record<string, Record<string, unknown>>;
  approvals: Map<string, RunApprovalState>;
  activeTaskIds: Set<string>;
  timers: Set<NodeJS.Timeout>;
  doneResolved: boolean;
  resolveDone: (result: WorkflowRunResult) => void;
  done: Promise<WorkflowRunResult>;
}

type SpawnOnlySubagentManager = Pick<SubagentManager, "spawnTask"> &
  Partial<
    Pick<
      SubagentManager,
      "cancelBySession" | "cancelPendingApprovalsByTask" | "cancelPendingApprovalsBySession"
    >
  >;

export class WorkflowEngine {
  private readonly bus: MessageBus;
  private readonly subagents: SpawnOnlySubagentManager;
  private readonly config: AppConfig;
  private readonly skillsLoader: SkillsLoader;
  private readonly onSnapshot?: (snapshot: WorkflowRunSnapshot) => void | Promise<void>;
  private readonly onActivity?: (activity: WorkflowRunActivityRecord) => void | Promise<void>;
  private readonly runs = new Map<string, RunRuntimeState>();
  private readonly taskIndex = new Map<string, TrackedTask>();
  private readonly runWorkChains = new Map<string, Promise<void>>();
  private readonly unsubscribers: Array<() => void>;

  constructor(options: {
    bus: MessageBus;
    subagents: SpawnOnlySubagentManager;
    workspace: string;
    config: AppConfig;
    onSnapshot?: (snapshot: WorkflowRunSnapshot) => void | Promise<void>;
    onActivity?: (activity: WorkflowRunActivityRecord) => void | Promise<void>;
  }) {
    this.bus = options.bus;
    this.subagents = options.subagents;
    this.config = options.config;
    this.skillsLoader = new SkillsLoader(options.workspace);
    this.onSnapshot = options.onSnapshot;
    this.onActivity = options.onActivity;
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
  }

  async start(
    definitionInput: unknown,
    options: StartWorkflowOptions,
  ): Promise<WorkflowRunHandle> {
    const definition = parseWorkflowDefinition(definitionInput);
    this.validateRoles(definition);
    await this.validateSkills(definition);

    const runId = randomUUID().replace(/-/g, "").slice(0, 12);
    const topoOrder = topologicalSort(definition);

    let resolveDone!: (result: WorkflowRunResult) => void;
    const done = new Promise<WorkflowRunResult>((resolve) => {
      resolveDone = resolve;
    });

    const nodes = new Map<string, NodeRuntimeState>(
      definition.nodes.map((node) => [
        node.id,
        {
          definition: node,
          status: "pending",
          attempt: 0,
          currentTaskId: null,
          lastError: null,
        },
      ]),
    );

    const state: RunRuntimeState = {
      runId,
      definition,
      status: "running",
      startedAt: new Date(),
      endedAt: null,
      error: null,
      triggerInput: structuredClone(options.triggerInput),
      originChannel: options.originChannel,
      originChatId: options.originChatId,
      topoOrder,
      nodes,
      outputs: {},
      approvals: new Map(),
      activeTaskIds: new Set(),
      timers: new Set(),
      doneResolved: false,
      resolveDone,
      done,
    };

    this.runs.set(runId, state);
    this.emitSnapshot(runId);
    void this.enqueueRunWork(runId, async () => {
      await this.scheduleRun(runId);
    });

    return {
      runId,
      done,
    };
  }

  getRunSnapshot(runId: string): WorkflowRunSnapshot | null {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }

    return {
      runId: run.runId,
      workflowId: run.definition.id,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      endedAt: run.endedAt ? run.endedAt.toISOString() : null,
      error: run.error,
      execution: {
        mode: run.definition.execution.mode,
        maxParallel: run.definition.execution.maxParallel,
      },
      triggerInput: structuredClone(run.triggerInput),
      originChannel: run.originChannel,
      originChatId: run.originChatId,
      activeTaskIds: Array.from(run.activeTaskIds),
      outputs: structuredClone(run.outputs),
      approvals: Array.from(run.approvals.values()).map((approval) => ({
        approvalId: approval.approvalId,
        taskId: approval.taskId,
        nodeId: approval.nodeId,
        nodeName: approval.nodeName,
        status: approval.status,
        approvalTarget: approval.approvalTarget,
        requestedAt: approval.requestedAt.toISOString(),
        expiresAt: approval.expiresAt.toISOString(),
        approvedAt: approval.approvedAt ? approval.approvedAt.toISOString() : null,
        approver: approval.approver,
        commandPreview: approval.commandPreview,
        toolCalls: approval.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
          highRisk: toolCall.highRisk,
        })),
        reason: approval.reason,
      })),
      nodes: run.definition.nodes.map((node) => {
        const runtime = run.nodes.get(node.id);
        return {
          id: node.id,
          name: node.name,
          status: runtime?.status ?? "pending",
          attempt: runtime?.attempt ?? 0,
          maxAttempts: node.retry.maxAttempts,
          currentTaskId: runtime?.currentTaskId ?? null,
          lastError: runtime?.lastError ?? null,
        };
      }),
    };
  }

  getApprovals(options?: { pendingOnly?: boolean }): WorkflowApprovalSnapshot[] {
    const pendingOnly = options?.pendingOnly === true;
    const out: WorkflowApprovalSnapshot[] = [];
    for (const run of this.runs.values()) {
      for (const approval of run.approvals.values()) {
        if (pendingOnly && approval.status !== "pending") {
          continue;
        }
        out.push({
          runId: run.runId,
          workflowId: run.definition.id,
          approvalId: approval.approvalId,
          taskId: approval.taskId,
          nodeId: approval.nodeId,
          nodeName: approval.nodeName,
          status: approval.status,
          approvalTarget: approval.approvalTarget,
          requestedAt: approval.requestedAt.toISOString(),
          expiresAt: approval.expiresAt.toISOString(),
          approvedAt: approval.approvedAt ? approval.approvedAt.toISOString() : null,
          approver: approval.approver,
          commandPreview: approval.commandPreview,
          toolCalls: approval.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
            highRisk: toolCall.highRisk,
          })),
          reason: approval.reason,
        });
      }
    }
    out.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    return out;
  }

  async cancel(runId: string): Promise<void> {
    await this.enqueueRunWork(runId, async () => {
      const run = this.runs.get(runId);
      if (!run || (run.status !== "running" && run.status !== "waiting_for_approval")) {
        return;
      }
      this.finishRun(run, "cancelled", "Workflow run cancelled.");
    });
  }

  close(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    for (const run of this.runs.values()) {
      this.clearRunTimers(run);
      if (run.status === "running" || run.status === "waiting_for_approval") {
        this.finishRun(run, "cancelled", "Workflow engine closed before completion.");
        this.emitSnapshot(run.runId);
      }
    }
  }

  private validateRoles(definition: NormalizedWorkflowDefinition): void {
    for (const node of definition.nodes) {
      const roleError = validateRoleName(this.config, node.role);
      if (roleError) {
        throw new Error(`Workflow node '${node.id}' has invalid role: ${roleError}`);
      }
    }
  }

  private async validateSkills(definition: NormalizedWorkflowDefinition): Promise<void> {
    const uniqueSkills = new Set<string>();
    for (const node of definition.nodes) {
      for (const skillName of node.skillNames) {
        uniqueSkills.add(skillName);
      }
    }

    for (const skillName of uniqueSkills) {
      const content = await this.skillsLoader.loadSkill(skillName);
      if (!content) {
        throw new Error(`Workflow references unknown skill '${skillName}'.`);
      }
    }
  }

  private async onSubagentEvent(event: SubagentTaskEvent): Promise<void> {
    const tracked = this.taskIndex.get(event.taskId);
    if (!tracked) {
      return;
    }

    await this.enqueueRunWork(tracked.runId, async () => {
      const run = this.runs.get(tracked.runId);
      if (!run || (run.status !== "running" && run.status !== "waiting_for_approval")) {
        this.taskIndex.delete(event.taskId);
        return;
      }

      const node = run.nodes.get(tracked.nodeId);
      if (!node || node.currentTaskId !== event.taskId) {
        this.taskIndex.delete(event.taskId);
        run.activeTaskIds.delete(event.taskId);
        return;
      }

      this.taskIndex.delete(event.taskId);
      run.activeTaskIds.delete(event.taskId);
      node.currentTaskId = null;

      this.emitActivity({
        id: `activity_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        runId: run.runId,
        nodeId: tracked.nodeId,
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
      });

      if (event.type === "SUBAGENT_TASK_COMPLETED") {
        try {
          const output = extractJsonObject(event.result);
          this.validateOutputKeys(node.definition, output);
          node.status = "completed";
          node.lastError = null;
          run.outputs[node.definition.id] = output;
          await this.scheduleRun(run.runId);
          return;
        } catch (error) {
          await this.handleNodeFailure(run, node, error);
          await this.scheduleRun(run.runId);
          return;
        }
      }

      const eventError = event.result || "Subagent reported failure.";
      await this.handleNodeFailure(run, node, eventError);
      await this.scheduleRun(run.runId);
    });
  }

  private async onApprovalRequested(event: SubagentApprovalRequestedEvent): Promise<void> {
    const tracked = this.taskIndex.get(event.taskId);
    if (!tracked) {
      return;
    }

    await this.enqueueRunWork(tracked.runId, async () => {
      const run = this.runs.get(tracked.runId);
      if (!run || (run.status !== "running" && run.status !== "waiting_for_approval")) {
        return;
      }

      const node = run.nodes.get(tracked.nodeId);
      if (!node || node.currentTaskId !== event.taskId) {
        return;
      }

      run.approvals.set(event.approvalId, {
        approvalId: event.approvalId,
        taskId: event.taskId,
        nodeId: tracked.nodeId,
        nodeName: event.nodeName,
        status: "pending",
        approvalTarget: event.approvalTarget,
        requestedAt: event.requestedAt,
        expiresAt: event.expiresAt,
        approvedAt: null,
        approver: null,
        commandPreview: event.commandPreview,
        toolCalls: event.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
          highRisk: toolCall.highRisk,
        })),
        reason: null,
      });

      node.status = "waiting_for_approval";
      run.status = "waiting_for_approval";
    });
  }

  private async onApprovalGranted(event: SubagentApprovalGrantedEvent): Promise<void> {
    const tracked = this.taskIndex.get(event.taskId);
    if (!tracked) {
      return;
    }

    await this.enqueueRunWork(tracked.runId, async () => {
      const run = this.runs.get(tracked.runId);
      if (!run || (run.status !== "running" && run.status !== "waiting_for_approval")) {
        return;
      }

      const approval = run.approvals.get(event.approvalId);
      if (!approval || approval.taskId !== event.taskId) {
        return;
      }

      approval.status = "approved";
      approval.approvedAt = event.approvedAt;
      approval.approver = event.approver;
      approval.reason = null;

      const node = run.nodes.get(approval.nodeId);
      if (node && node.currentTaskId === event.taskId && node.status === "waiting_for_approval") {
        node.status = "running";
      }

      run.status = this.hasPendingApprovals(run) ? "waiting_for_approval" : "running";
      await this.scheduleRun(run.runId);
    });
  }

  private async onApprovalExpired(event: SubagentApprovalExpiredEvent): Promise<void> {
    await this.onApprovalTerminal(event.approvalId, event.taskId, "expired", event.reason);
  }

  private async onApprovalCancelled(event: SubagentApprovalCancelledEvent): Promise<void> {
    await this.onApprovalTerminal(event.approvalId, event.taskId, "cancelled", event.reason);
  }

  private async onApprovalTerminal(
    approvalId: string,
    taskId: string,
    status: "expired" | "cancelled",
    reason: string,
  ): Promise<void> {
    const tracked = this.taskIndex.get(taskId);
    if (!tracked) {
      return;
    }

    await this.enqueueRunWork(tracked.runId, async () => {
      const run = this.runs.get(tracked.runId);
      if (!run || (run.status !== "running" && run.status !== "waiting_for_approval")) {
        return;
      }

      const approval = run.approvals.get(approvalId);
      if (!approval || approval.taskId !== taskId) {
        return;
      }
      approval.status = status;
      approval.reason = reason;
      run.status = this.hasPendingApprovals(run) ? "waiting_for_approval" : "running";

      const node = run.nodes.get(approval.nodeId);
      if (!node || node.currentTaskId !== taskId) {
        return;
      }
      if (node.status === "waiting_for_approval") {
        node.status = "running";
      }
      await this.handleNodeFailure(run, node, reason);
      await this.scheduleRun(run.runId);
    });
  }

  private hasPendingApprovals(run: RunRuntimeState): boolean {
    return Array.from(run.approvals.values()).some((approval) => approval.status === "pending");
  }

  private enqueueRunWork(runId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.runWorkChains.get(runId) ?? Promise.resolve();
    const current = previous
      .catch(() => {
        // Keep execution chain alive after failures.
      })
      .then(async () => {
        await work();
        this.emitSnapshot(runId);
      })
      .finally(() => {
        if (this.runWorkChains.get(runId) === current) {
          this.runWorkChains.delete(runId);
        }
      });

    this.runWorkChains.set(runId, current);
    return current;
  }

  private async scheduleRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") {
      return;
    }

    const maxParallel =
      run.definition.execution.mode === "serial"
        ? 1
        : run.definition.execution.maxParallel;

    while (run.status === "running" && run.activeTaskIds.size < maxParallel) {
      const nextNode = this.pickReadyNode(run);
      if (!nextNode) {
        break;
      }

      await this.startNode(run, nextNode);
    }

    if (run.status !== "running") {
      return;
    }

    const allDone = Array.from(run.nodes.values()).every((node) => node.status === "completed");
    if (allDone) {
      this.finishRun(run, "completed");
      return;
    }

    if (run.activeTaskIds.size > 0 || this.hasPendingApprovals(run)) {
      return;
    }

    const hasRunningNodes = Array.from(run.nodes.values()).some(
      (node) => node.status === "running" || node.status === "waiting_for_approval",
    );
    const nextReady = this.pickReadyNode(run);
    if (nextReady || !hasRunningNodes) {
      return;
    }

    const blocked = Array.from(run.nodes.values())
      .filter((node) => node.status !== "completed")
      .map((node) => `${node.definition.id}:${node.status}`)
      .join(", ");
    this.finishRun(
      run,
      "failed",
      `Workflow '${run.definition.id}' became unschedulable: no active tasks but nodes still running/waiting. Remaining nodes: ${blocked}`,
    );
  }

  private pickReadyNode(run: RunRuntimeState): NodeRuntimeState | null {
    for (const nodeId of run.topoOrder) {
      const node = run.nodes.get(nodeId);
      if (!node || node.status !== "pending") {
        continue;
      }

      const depsCompleted = node.definition.dependsOn.every((depId) => {
        const dep = run.nodes.get(depId);
        return dep?.status === "completed";
      });
      if (!depsCompleted) {
        continue;
      }

      return node;
    }

    return null;
  }

  private buildNodeTaskPrompt(
    node: NormalizedWorkflowNodeDefinition,
    triggerInput: Record<string, unknown>,
    outputs: Record<string, Record<string, unknown>>,
  ): string {
    const interpolated = interpolateTemplate(node.taskPrompt, {
      trigger: triggerInput,
      nodes: outputs,
    });

    const outputKeyHint =
      node.outputKeys.length > 0
        ? `Required top-level JSON keys: ${node.outputKeys.join(", ")}.`
        : "Include all relevant top-level fields in the JSON object output.";

    return `${interpolated}

Output contract:
- Return a JSON object as your final answer.
- Do not omit required fields.
- Avoid extra prose outside the JSON object.
${outputKeyHint}`;
  }

  private async startNode(run: RunRuntimeState, node: NodeRuntimeState): Promise<void> {
    node.attempt += 1;
    node.status = "running";
    node.lastError = null;

    const sessionKey = `workflow:${run.runId}:${node.definition.id}:${node.attempt}`;
    const originChannel = "workflow";
    const originChatId = `${run.runId}:${node.definition.id}`;

    let spawnResult: SpawnTaskResult;
    try {
      const task = this.buildNodeTaskPrompt(node.definition, run.triggerInput, run.outputs);
      const spawnInput: SpawnTaskOptions = {
        task,
        role: node.definition.role,
        label: node.definition.name ?? node.definition.id,
        originChannel,
        originChatId,
        sessionKey,
        skillNames: node.definition.skillNames,
        announceToMainAgent: false,
        workflowContext: {
          runId: run.runId,
          nodeId: node.definition.id,
          nodeName: node.definition.name ?? node.definition.id,
          hitl: node.definition.hitl.enabled
            ? {
                enabled: true,
                highRiskTools: node.definition.hitl.highRiskTools,
                approvalTarget: node.definition.hitl.approvalTarget,
                approvalTimeoutMs: node.definition.hitl.approvalTimeoutMs,
              }
            : undefined,
        },
      };
      spawnResult = await this.subagents.spawnTask(spawnInput);
    } catch (error) {
      node.currentTaskId = null;
      await this.handleNodeFailure(run, node, error);
      return;
    }

    node.currentTaskId = spawnResult.taskId;
    run.activeTaskIds.add(spawnResult.taskId);
    this.taskIndex.set(spawnResult.taskId, {
      runId: run.runId,
      nodeId: node.definition.id,
      attempt: node.attempt,
      sessionKey,
    });
  }

  private validateOutputKeys(
    node: NormalizedWorkflowNodeDefinition,
    output: Record<string, unknown>,
  ): void {
    for (const key of node.outputKeys) {
      if (!(key in output)) {
        throw new Error(
          `Node '${node.id}' output missing required key '${key}'.`,
        );
      }
    }
  }

  private async handleNodeFailure(
    run: RunRuntimeState,
    node: NodeRuntimeState,
    error: unknown,
  ): Promise<void> {
    if (run.status !== "running" && run.status !== "waiting_for_approval") {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    node.lastError = message;
    node.currentTaskId = null;

    if (node.attempt < node.definition.retry.maxAttempts) {
      node.status = "pending";
      const delay = node.definition.retry.backoffMs;
      if (delay > 0) {
        const timer = setTimeout(() => {
          run.timers.delete(timer);
          void this.enqueueRunWork(run.runId, async () => {
            await this.scheduleRun(run.runId);
          });
        }, delay);
        run.timers.add(timer);
      }
      return;
    }

    node.status = "failed";
    this.finishRun(
      run,
      "failed",
      `Node '${node.definition.id}' failed after ${node.attempt} attempt(s): ${message}`,
    );
  }

  private finishRun(
    run: RunRuntimeState,
    status: "completed" | "failed" | "cancelled",
    error?: string,
  ): void {
    if (run.doneResolved) {
      return;
    }

    run.status = status;
    run.endedAt = new Date();
    run.error = error ?? null;
    run.doneResolved = true;

    this.clearRunTimers(run);

    const activeSessions = new Set<string>();
    const activeTaskIds = Array.from(run.activeTaskIds);
    for (const taskId of run.activeTaskIds) {
      const tracked = this.taskIndex.get(taskId);
      if (tracked) {
        activeSessions.add(tracked.sessionKey);
      }
      this.taskIndex.delete(taskId);
    }
    run.activeTaskIds.clear();

    if ((status === "failed" || status === "cancelled") && activeSessions.size > 0) {
      this.markPendingApprovalsCancelled(
        run,
        error ?? "Workflow terminated before approval completion.",
      );
      this.cancelPendingApprovals(activeTaskIds, activeSessions, error ?? "Workflow terminated.");
      void this.cancelSessions(activeSessions);
    }

    run.resolveDone({
      runId: run.runId,
      status,
      outputs: structuredClone(run.outputs),
      ...(run.error ? { error: run.error } : {}),
    });
  }

  private emitSnapshot(runId: string): void {
    if (!this.onSnapshot) {
      return;
    }
    const snapshot = this.getRunSnapshot(runId);
    if (!snapshot) {
      return;
    }
    try {
      const maybePromise = this.onSnapshot(snapshot);
      if (maybePromise && typeof (maybePromise as Promise<void>).then === "function") {
        void (maybePromise as Promise<void>).catch(() => {
          // Best effort snapshot persistence.
        });
      }
    } catch {
      // Best effort snapshot persistence.
    }
  }

  private emitActivity(activity: WorkflowRunActivityRecord): void {
    if (!this.onActivity) {
      return;
    }
    try {
      const maybePromise = this.onActivity(activity);
      if (maybePromise && typeof (maybePromise as Promise<void>).then === "function") {
        void (maybePromise as Promise<void>).catch(() => {
          // Best effort activity persistence.
        });
      }
    } catch {
      // Best effort activity persistence.
    }
  }

  private clearRunTimers(run: RunRuntimeState): void {
    for (const timer of run.timers) {
      clearTimeout(timer);
    }
    run.timers.clear();
  }

  private markPendingApprovalsCancelled(run: RunRuntimeState, reason: string): void {
    for (const approval of run.approvals.values()) {
      if (approval.status !== "pending") {
        continue;
      }
      approval.status = "cancelled";
      approval.reason = reason;
    }
  }

  private cancelPendingApprovals(
    taskIds: string[],
    sessions: Set<string>,
    reason: string,
  ): void {
    const cancelByTask = this.subagents.cancelPendingApprovalsByTask;
    const cancelBySession = this.subagents.cancelPendingApprovalsBySession;

    if (cancelByTask) {
      for (const taskId of taskIds) {
        try {
          cancelByTask.call(this.subagents, taskId, reason);
        } catch {
          // Best effort cancellation.
        }
      }
      return;
    }

    if (cancelBySession) {
      for (const sessionKey of sessions) {
        try {
          cancelBySession.call(this.subagents, sessionKey, reason);
        } catch {
          // Best effort cancellation.
        }
      }
    }
  }

  private async cancelSessions(sessions: Set<string>): Promise<void> {
    const cancelBySession = this.subagents.cancelBySession;
    if (!cancelBySession) {
      return;
    }

    for (const sessionKey of sessions) {
      try {
        await cancelBySession.call(this.subagents, sessionKey);
      } catch {
        // Best effort cancellation.
      }
    }
  }
}
