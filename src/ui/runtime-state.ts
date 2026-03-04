import type { ServerResponse } from "node:http";

import type {
  SubagentApprovalCancelledEvent,
  SubagentApprovalExpiredEvent,
  SubagentApprovalGrantedEvent,
  SubagentApprovalRequestedEvent,
} from "../bus/events.js";
import { MessageBus } from "../bus/message-bus.js";
import {
  WorkflowEngine,
  type StartWorkflowOptions,
  type WorkflowApprovalSnapshot,
  type WorkflowRunHandle,
  type WorkflowRunSnapshot,
} from "../workflow/engine.js";

interface StartRuntimeWorkflowInput {
  definition: unknown;
  triggerInput?: Record<string, unknown>;
  originChannel?: string;
  originChatId?: string;
}

export class UiRuntimeState {
  private readonly bus: MessageBus;
  private readonly engine: WorkflowEngine;
  private readonly sseClients = new Set<ServerResponse>();
  private readonly unsubscribers: Array<() => void>;
  private readonly runHandles = new Map<string, WorkflowRunHandle>();

  constructor(options: { bus: MessageBus; engine: WorkflowEngine }) {
    this.bus = options.bus;
    this.engine = options.engine;

    this.unsubscribers = [
      this.bus.onSubagentApprovalRequested((event) => {
        this.broadcast("approval.requested", {
          event: this.serializeApprovalRequestedEvent(event),
        });
        this.broadcastRunStatus(event.runId);
      }),
      this.bus.onSubagentApprovalGranted((event) => {
        this.broadcast("approval.updated", {
          event: this.serializeApprovalGrantedEvent(event),
        });
        this.broadcastRunStatusByApproval(event.approvalId);
      }),
      this.bus.onSubagentApprovalExpired((event) => {
        this.broadcast("approval.updated", {
          event: this.serializeApprovalExpiredEvent(event),
        });
        this.broadcastRunStatusByApproval(event.approvalId);
      }),
      this.bus.onSubagentApprovalCancelled((event) => {
        this.broadcast("approval.updated", {
          event: this.serializeApprovalCancelledEvent(event),
        });
        this.broadcastRunStatusByApproval(event.approvalId);
      }),
    ];
  }

  close(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();
  }

  attachApprovalStream(res: ServerResponse): void {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.write("retry: 1500\n\n");

    this.sseClients.add(res);
    this.broadcastTo(res, "stream.connected", {
      now: new Date().toISOString(),
    });

    res.on("close", () => {
      this.sseClients.delete(res);
    });
  }

  listApprovals(options?: { pendingOnly?: boolean }): WorkflowApprovalSnapshot[] {
    return this.engine.getApprovals(options);
  }

  async approve(approvalId: string, approver: string): Promise<void> {
    const pending = this.engine
      .getApprovals({ pendingOnly: true })
      .find((approval) => approval.approvalId === approvalId);
    if (!pending) {
      throw new Error("Approval not found or already resolved.");
    }

    await this.bus.emitSubagentApprovalGranted({
      type: "SUBAGENT_APPROVAL_GRANTED",
      approvalId,
      taskId: pending.taskId,
      approver,
      approvedAt: new Date(),
    });
  }

  async startWorkflow(input: StartRuntimeWorkflowInput): Promise<{ runId: string }> {
    const startOptions: StartWorkflowOptions = {
      triggerInput: input.triggerInput ?? {},
      originChannel: input.originChannel ?? "ui",
      originChatId: input.originChatId ?? "studio",
    };

    const handle = await this.engine.start(input.definition, startOptions);
    this.runHandles.set(handle.runId, handle);
    this.broadcastRunStatus(handle.runId);

    void handle.done.finally(() => {
      this.broadcastRunStatus(handle.runId);
      this.runHandles.delete(handle.runId);
    });

    return {
      runId: handle.runId,
    };
  }

  getRun(runId: string): WorkflowRunSnapshot | null {
    return this.engine.getRunSnapshot(runId);
  }

  async cancelRun(runId: string): Promise<void> {
    await this.engine.cancel(runId);
    this.broadcastRunStatus(runId);
  }

  private broadcast(event: string, data: Record<string, unknown>): void {
    if (this.sseClients.size === 0) {
      return;
    }

    const payload: Record<string, unknown> = {
      type: event,
      data,
    };

    for (const client of this.sseClients) {
      this.broadcastTo(client, event, payload);
    }
  }

  private broadcastTo(res: ServerResponse, event: string, payload: Record<string, unknown>): void {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  private broadcastRunStatus(runId: string): void {
    const snapshot = this.engine.getRunSnapshot(runId);
    if (!snapshot) {
      return;
    }
    this.broadcast("run.status.changed", {
      runId,
      status: snapshot.status,
      run: snapshot,
    });
  }

  private broadcastRunStatusByApproval(approvalId: string): void {
    const approval = this.engine
      .getApprovals()
      .find((item) => item.approvalId === approvalId);
    if (!approval) {
      return;
    }
    this.broadcastRunStatus(approval.runId);
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
