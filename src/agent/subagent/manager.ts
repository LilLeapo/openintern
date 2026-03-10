import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type {
  AgentTraceEvent,
  ApprovalToolCall,
  InboundMessage,
  SubagentApprovalGrantedEvent,
  SubagentTaskMessage,
  SubagentTaskEvent,
  SubagentTaskToolCall,
} from "../../bus/events.js";
import { formatAgentTraceProgress } from "../../bus/events.js";
import { MessageBus } from "../../bus/message-bus.js";
import { resolveRole, validateRoleName } from "../../config/role-resolver.js";
import type { AppConfig, RoleConfig } from "../../config/schema.js";
import type { LLMProvider, ToolCallRequest } from "../../llm/provider.js";
import { ExecTool } from "../../tools/builtins/exec.js";
import {
  EditFileTool,
  ListDirTool,
  ReadFileTool,
  WriteFileTool,
} from "../../tools/builtins/filesystem.js";
import { InspectFileTool, ReadImageTool } from "../../tools/builtins/media.js";
import {
  MemoryRetrieveTool,
  MemorySaveTool,
  type MemoryScopeResolver,
} from "../../tools/builtins/memory.js";
import {
  ScopedMemoryRetrieveTool,
  ScopedMemorySaveTool,
} from "../../tools/builtins/scoped-memory.js";
import { WebFetchTool, WebSearchTool } from "../../tools/builtins/web.js";
import type { Tool } from "../../tools/core/tool.js";
import { ToolRegistry } from "../../tools/core/tool-registry.js";
import { ContextBuilder, sanitizeToolResultForContext } from "../context/context-builder.js";
import type { MemUClient } from "../memory/memu-client.js";
import { SkillsLoader } from "../skills/loader.js";

interface RunningTask {
  task: Promise<void>;
  abortController: AbortController;
}

interface PendingApproval {
  approvalId: string;
  taskId: string;
  sessionKey: string;
  timer: NodeJS.Timeout;
  resolve: () => void;
  reject: (error: Error) => void;
  spanId: string;
  parentSpanId: string | null;
  originChannel: string;
  originChatId: string;
  originMessageId?: string;
  runId: string;
  iteration?: number;
  agentId: string;
  agentName: string;
}

const MAX_LOG_CONTENT = 6_000;

function nowIso(): string {
  return new Date().toISOString();
}

function truncateLogContent(value: string): string {
  if (value.length <= MAX_LOG_CONTENT) {
    return value;
  }
  return `${value.slice(0, MAX_LOG_CONTENT)}\n...(truncated)`;
}

export interface SubagentManagerOptions {
  provider: LLMProvider;
  workspace: string;
  bus: MessageBus;
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort: string | null;
  webSearchApiKey?: string;
  webSearchMaxResults?: number;
  webProxy?: string | null;
  execTimeoutSeconds?: number;
  restrictToWorkspace?: boolean;
  config: AppConfig;
  memuClient?: MemUClient | null;
  memuScopeResolver?: MemoryScopeResolver;
  maxConcurrent?: number;
  externalToolRegistry?: ToolRegistry;
}

export interface SpawnTaskOptions {
  task: string;
  role?: string | null;
  label?: string | null;
  originChannel: string;
  originChatId: string;
  sessionKey: string;
  originMessageId?: string;
  skillNames?: string[];
  announceToMainAgent?: boolean;
  workflowContext?: {
    runId: string;
    nodeId: string;
    nodeName: string;
    hitl?: {
      enabled: boolean;
      highRiskTools: string[];
      approvalTarget: "owner" | "group";
      approvalTimeoutMs: number;
    };
  };
}

export interface SpawnTaskResult {
  taskId: string;
  label: string;
  queued: boolean;
  queuePosition: number | null;
  ack: string;
}

export class SubagentManager {
  private readonly runningTasks = new Map<string, RunningTask>();
  private readonly sessionTasks = new Map<string, Set<string>>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly taskToApprovals = new Map<string, Set<string>>();
  private readonly unsubscribeApprovalGranted: () => void;

  private readonly provider: LLMProvider;
  private readonly workspace: string;
  private readonly bus: MessageBus;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly reasoningEffort: string | null;
  private readonly webSearchApiKey: string;
  private readonly webSearchMaxResults: number;
  private readonly webProxy: string | null;
  private readonly execTimeoutSeconds: number;
  private readonly restrictToWorkspace: boolean;
  private readonly configRef: AppConfig;
  private readonly memuClient: MemUClient | null;
  private readonly memuScopeResolver?: MemoryScopeResolver;
  private readonly externalToolRegistry?: ToolRegistry;

  private readonly maxConcurrent: number;
  private runningCount = 0;
  private readonly waitQueue: Array<() => void> = [];

  constructor(options: SubagentManagerOptions) {
    this.provider = options.provider;
    this.workspace = options.workspace;
    this.bus = options.bus;
    this.model = options.model;
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
    this.reasoningEffort = options.reasoningEffort;
    this.webSearchApiKey = options.webSearchApiKey ?? "";
    this.webSearchMaxResults = options.webSearchMaxResults ?? 5;
    this.webProxy = options.webProxy ?? null;
    this.execTimeoutSeconds = options.execTimeoutSeconds ?? 60;
    this.restrictToWorkspace = options.restrictToWorkspace ?? false;
    this.configRef = options.config;
    this.memuClient = options.memuClient ?? null;
    this.memuScopeResolver = options.memuScopeResolver;
    this.externalToolRegistry = options.externalToolRegistry;

    const configMax = options.config.agents.subagentConcurrency.maxConcurrent;
    const inputMax = options.maxConcurrent ?? configMax;
    const normalized = Number.isFinite(inputMax) ? Math.floor(inputMax) : 1;
    this.maxConcurrent = Math.max(1, normalized);

    this.unsubscribeApprovalGranted = this.bus.onSubagentApprovalGranted((event) => {
      this.onApprovalGranted(event);
    });
  }

  private newTraceSpanId(): string {
    return `span_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }

  private traceEnabled(level: "basic" | "verbose" = "basic"): boolean {
    const trace = this.configRef.agents.trace;
    if (!trace.enabled || !trace.includeSubagents) {
      return false;
    }
    if (level === "verbose" && trace.level !== "verbose") {
      return false;
    }
    return true;
  }

  private shouldMirrorTraceToProgress(): boolean {
    const trace = this.configRef.agents.trace;
    return trace.enabled && trace.includeSubagents && trace.mirrorToProgress;
  }

  private async emitSubagentTraceEvent(
    event: Omit<AgentTraceEvent, "type" | "timestamp" | "sourceType">,
  ): Promise<void> {
    const fullEvent: AgentTraceEvent = {
      type: "AGENT_TRACE",
      timestamp: new Date(),
      sourceType: "subagent",
      ...event,
    };
    await this.bus.emitAgentTraceEvent(fullEvent);
    if (!this.shouldMirrorTraceToProgress()) {
      return;
    }
    await this.bus.publishOutbound({
      channel: fullEvent.originChannel,
      chatId: fullEvent.originChatId,
      content: formatAgentTraceProgress(fullEvent),
      metadata: {
        _progress: true,
        ...(typeof fullEvent.metadata?.message_id === "string"
          ? {
              message_id: fullEvent.metadata.message_id,
            }
          : {}),
        _debug: true,
        _agent_trace: true,
        _agent_id: fullEvent.agentId,
        _agent_name: fullEvent.agentName,
        _trace_run_id: fullEvent.runId,
        _trace_span_id: fullEvent.spanId,
        _trace_parent_span_id: fullEvent.parentSpanId,
        _trace_event_type: fullEvent.eventType,
        _trace_phase: fullEvent.phase,
        _trace_status: fullEvent.status,
        ...(typeof fullEvent.iteration === "number"
          ? {
              _trace_iteration: fullEvent.iteration,
            }
          : {}),
      },
    });
  }

  async spawn(options: {
    task: string;
    role?: string | null;
    label?: string | null;
    originChannel: string;
    originChatId: string;
    sessionKey: string;
    originMessageId?: string;
  }): Promise<string> {
    try {
      const started = await this.spawnTask(options);
      return started.ack;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async spawnTask(options: SpawnTaskOptions): Promise<SpawnTaskResult> {
    const role = options.role?.trim() ? options.role.trim() : null;
    if (role) {
      const roleError = validateRoleName(this.configRef, role);
      if (roleError) {
        throw new Error(roleError);
      }
    }

    const roleConfig = role ? resolveRole(this.configRef, role) : null;
    if (role && !roleConfig) {
      throw new Error(`Error: Role '${role}' is invalid in config.`);
    }

    const skillNames = Array.from(
      new Set(
        (options.skillNames ?? [])
          .map((name) => name.trim())
          .filter((name) => name.length > 0),
      ),
    );
    const announceToMainAgent = options.announceToMainAgent ?? true;
    const workflowContext = options.workflowContext
      ? {
          runId: options.workflowContext.runId,
          nodeId: options.workflowContext.nodeId,
          nodeName: options.workflowContext.nodeName,
          hitl: options.workflowContext.hitl
            ? {
                enabled: options.workflowContext.hitl.enabled === true,
                highRiskTools: Array.from(
                  new Set(
                    options.workflowContext.hitl.highRiskTools
                      .map((name) => name.trim())
                      .filter((name) => name.length > 0),
                  ),
                ),
                approvalTarget: options.workflowContext.hitl.approvalTarget,
                approvalTimeoutMs: options.workflowContext.hitl.approvalTimeoutMs,
              }
            : undefined,
        }
      : undefined;

    const taskId = randomUUID().slice(0, 8);
    const label =
      options.label?.trim() ||
      (options.task.length > 30 ? `${options.task.slice(0, 30)}...` : options.task);

    const queued = this.runningCount >= this.maxConcurrent;
    const queuePosition = queued ? this.waitQueue.length + 1 : null;

    const abortController = new AbortController();
    const runTask = this.runSubagent({
      taskId,
      role,
      roleConfig,
      label,
      task: options.task,
      originChannel: options.originChannel,
      originChatId: options.originChatId,
      originMessageId: options.originMessageId,
      sessionKey: options.sessionKey,
      skillNames,
      announceToMainAgent,
      workflowContext,
      signal: abortController.signal,
    });
    const wrapped: RunningTask = {
      abortController,
      task: runTask.finally(() => {
        this.cancelPendingApprovalsByTask(
          taskId,
          "Task ended before approval was completed.",
        );
        this.runningTasks.delete(taskId);
        const set = this.sessionTasks.get(options.sessionKey);
        if (!set) {
          return;
        }
        set.delete(taskId);
        if (set.size === 0) {
          this.sessionTasks.delete(options.sessionKey);
        }
      }),
    };
    this.runningTasks.set(taskId, wrapped);
    if (!this.sessionTasks.has(options.sessionKey)) {
      this.sessionTasks.set(options.sessionKey, new Set());
    }
    this.sessionTasks.get(options.sessionKey)?.add(taskId);

    const ack =
      queued && queuePosition !== null
        ? `Subagent [${label}] queued (id: ${taskId}, position: ${queuePosition} in queue). I'll notify you when it completes.`
        : `Subagent [${label}] started (id: ${taskId}). I'll notify you when it completes.`;

    return {
      taskId,
      label,
      queued,
      queuePosition,
      ack,
    };
  }

  cancelPendingApprovalsByTask(taskId: string, reason = "Approval cancelled."): number {
    const ids = Array.from(this.taskToApprovals.get(taskId) ?? []);
    if (ids.length === 0) {
      return 0;
    }

    let cancelled = 0;
    for (const approvalId of ids) {
      const pending = this.takePendingApproval(approvalId);
      if (!pending) {
        continue;
      }
      cancelled += 1;
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      if (this.traceEnabled()) {
        void this.emitSubagentTraceEvent({
          runId: pending.runId,
          spanId: pending.spanId,
          parentSpanId: pending.parentSpanId,
          agentId: pending.agentId,
          agentName: pending.agentName,
          eventType: "approval",
          phase: "end",
          status: "cancelled",
          iteration: pending.iteration,
          content: `Approval cancelled: ${reason}`,
          originChannel: pending.originChannel,
          originChatId: pending.originChatId,
          metadata: {
            approvalId,
            ...(pending.originMessageId
              ? {
                  message_id: pending.originMessageId,
                }
              : {}),
          },
        });
      }
      void this.bus.emitSubagentApprovalCancelled({
        type: "SUBAGENT_APPROVAL_CANCELLED",
        approvalId: pending.approvalId,
        taskId: pending.taskId,
        cancelledAt: new Date(),
        reason,
      });
    }

    return cancelled;
  }

  cancelPendingApprovalsBySession(
    sessionKey: string,
    reason = "Approval cancelled by session shutdown.",
  ): number {
    const taskIds = Array.from(this.sessionTasks.get(sessionKey) ?? []);
    if (taskIds.length === 0) {
      return 0;
    }
    let total = 0;
    for (const taskId of taskIds) {
      total += this.cancelPendingApprovalsByTask(taskId, reason);
    }
    return total;
  }

  async cancelBySession(sessionKey: string): Promise<number> {
    this.cancelPendingApprovalsBySession(
      sessionKey,
      "Approval cancelled because session was stopped.",
    );
    const ids = Array.from(this.sessionTasks.get(sessionKey) ?? []);
    if (ids.length === 0) {
      return 0;
    }
    const tasks: Promise<void>[] = [];
    for (const id of ids) {
      const running = this.runningTasks.get(id);
      if (!running) {
        continue;
      }
      running.abortController.abort();
      tasks.push(running.task);
    }
    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }
    return tasks.length;
  }

  getRunningCount(): number {
    return this.runningCount;
  }

  private async acquireSlot(): Promise<void> {
    if (this.runningCount < this.maxConcurrent) {
      this.runningCount += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
    this.runningCount += 1;
  }

  private releaseSlot(): void {
    this.runningCount = Math.max(0, this.runningCount - 1);
    const next = this.waitQueue.shift();
    if (next) {
      next();
    }
  }

  private setToolContext(tool: Tool, channel: string, chatId: string): void {
    const contextAware = tool as Tool & {
      setContext?: (originChannel: string, originChatId: string) => void;
    };
    if (typeof contextAware.setContext === "function") {
      contextAware.setContext(channel, chatId);
    }
  }

  private buildToolRegistry(options: {
    roleConfig: RoleConfig | null;
    taskWorkspace: string;
    originChannel: string;
    originChatId: string;
  }): ToolRegistry {
    const tools = new ToolRegistry();
    const forceWorkspaceSandbox =
      this.restrictToWorkspace || options.roleConfig?.workspaceIsolation === true;
    const allowedDir = forceWorkspaceSandbox ? options.taskWorkspace : undefined;

    const factories: Record<string, () => Tool> = {
      read_file: () => new ReadFileTool(options.taskWorkspace, allowedDir),
      inspect_file: () => new InspectFileTool(options.taskWorkspace, allowedDir),
      read_image: () =>
        new ReadImageTool(
          this.provider,
          this.model,
          this.maxTokens,
          this.reasoningEffort,
          options.taskWorkspace,
          allowedDir,
        ),
      write_file: () => new WriteFileTool(options.taskWorkspace, allowedDir),
      edit_file: () => new EditFileTool(options.taskWorkspace, allowedDir),
      list_dir: () => new ListDirTool(options.taskWorkspace, allowedDir),
      exec: () =>
        new ExecTool({
          timeoutMs: this.execTimeoutSeconds * 1000,
          workingDir: options.taskWorkspace,
          restrictToWorkspace: forceWorkspaceSandbox,
        }),
      web_search: () =>
        new WebSearchTool(this.webSearchApiKey, this.webSearchMaxResults, this.webProxy),
      web_fetch: () => new WebFetchTool(50_000, this.webProxy),
    };

    const memuClient = this.memuClient;
    const memuScopeResolver = this.memuScopeResolver;
    if (memuClient && memuScopeResolver) {
      if (options.roleConfig) {
        const forcedScope = options.roleConfig.memoryScope;
        factories.memory_save =
          () => new ScopedMemorySaveTool(memuClient, memuScopeResolver, forcedScope);
        factories.memory_retrieve =
          () => new ScopedMemoryRetrieveTool(memuClient, memuScopeResolver, forcedScope);
      } else {
        factories.memory_save = () => new MemorySaveTool(memuClient, memuScopeResolver);
        factories.memory_retrieve =
          () => new MemoryRetrieveTool(memuClient, memuScopeResolver);
      }
    }

    const selectedTools = options.roleConfig
      ? options.roleConfig.allowedTools
      : Object.keys(factories);

    for (const toolName of selectedTools) {
      const createTool = factories[toolName];
      if (createTool) {
        const tool = createTool();
        this.setToolContext(tool, options.originChannel, options.originChatId);
        tools.register(tool);
        continue;
      }
      const external = this.externalToolRegistry?.get(toolName);
      if (external) {
        // MCP tools are process-level and can be reused by subagents.
        this.setToolContext(external, options.originChannel, options.originChatId);
        tools.register(external);
      }
    }

    return tools;
  }

  private onApprovalGranted(event: SubagentApprovalGrantedEvent): void {
    const pending = this.pendingApprovals.get(event.approvalId);
    if (!pending || pending.taskId !== event.taskId) {
      return;
    }
    if (this.traceEnabled()) {
      void this.emitSubagentTraceEvent({
        runId: pending.runId,
        spanId: pending.spanId,
        parentSpanId: pending.parentSpanId,
        agentId: pending.agentId,
        agentName: pending.agentName,
        eventType: "approval",
        phase: "end",
        status: "granted",
        iteration: pending.iteration,
        content: `Approval granted by ${event.approver}.`,
        originChannel: pending.originChannel,
        originChatId: pending.originChatId,
        metadata: {
          approvalId: event.approvalId,
          approver: event.approver,
          ...(pending.originMessageId
            ? {
                message_id: pending.originMessageId,
              }
            : {}),
        },
      });
    }
    const removed = this.takePendingApproval(event.approvalId);
    if (!removed) {
      return;
    }
    clearTimeout(removed.timer);
    removed.resolve();
  }

  private takePendingApproval(approvalId: string): PendingApproval | null {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      return null;
    }
    this.pendingApprovals.delete(approvalId);
    const approvalSet = this.taskToApprovals.get(pending.taskId);
    if (approvalSet) {
      approvalSet.delete(approvalId);
      if (approvalSet.size === 0) {
        this.taskToApprovals.delete(pending.taskId);
      }
    }
    return pending;
  }

  private buildCommandPreview(toolCalls: ApprovalToolCall[]): string {
    const firstExec = toolCalls.find((toolCall) => toolCall.name === "exec");
    if (firstExec && typeof firstExec.arguments.command === "string") {
      return firstExec.arguments.command.slice(0, 200);
    }

    if (toolCalls.length === 1) {
      const only = toolCalls[0];
      const args = JSON.stringify(only.arguments);
      return `${only.name}(${args.slice(0, 180)})`;
    }

    const names = toolCalls.map((toolCall) => toolCall.name).join(", ");
    return `${toolCalls.length} tool calls: ${names}`.slice(0, 240);
  }

  private async waitForApproval(options: {
    taskId: string;
    label: string;
    sessionKey: string;
    originChannel: string;
    originChatId: string;
    originMessageId?: string;
    workflowContext?: SpawnTaskOptions["workflowContext"];
    toolCalls: ToolCallRequest[];
    signal: AbortSignal;
    iteration: number;
    parentSpanId: string | null;
  }): Promise<void> {
    const workflowContext = options.workflowContext;
    const hitl = workflowContext?.hitl;
    if (!workflowContext || !hitl?.enabled) {
      return;
    }

    const highRiskSet = new Set(hitl.highRiskTools);
    const approvalToolCalls: ApprovalToolCall[] = options.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
      highRisk: highRiskSet.has(toolCall.name),
    }));
    const approvalId = randomUUID().replace(/-/g, "").slice(0, 12);
    const requestedAt = new Date();
    const expiresAt = new Date(requestedAt.getTime() + hitl.approvalTimeoutMs);
    const commandPreview = this.buildCommandPreview(approvalToolCalls);
    const agentId = options.taskId;
    const agentName = options.label || options.taskId;
    const approvalSpanId = this.newTraceSpanId();

    let resolveApproval!: () => void;
    let rejectApproval!: (error: Error) => void;
    const waitApprovalPromise = new Promise<void>((resolve, reject) => {
      resolveApproval = resolve;
      rejectApproval = reject;
    });

    let timeoutReject!: (error: Error) => void;
    const timeoutPromise = new Promise<void>((_resolve, reject) => {
      timeoutReject = reject as (error: Error) => void;
    });

    const timeoutTimer = setTimeout(() => {
      const pending = this.takePendingApproval(approvalId);
      if (!pending) {
        return;
      }
      const timeoutError = new Error(
        `Approval timed out after ${hitl.approvalTimeoutMs}ms for task ${options.taskId}.`,
      );
      pending.reject(timeoutError);
      if (this.traceEnabled()) {
        void this.emitSubagentTraceEvent({
          runId: pending.runId,
          spanId: pending.spanId,
          parentSpanId: pending.parentSpanId,
          agentId: pending.agentId,
          agentName: pending.agentName,
          eventType: "approval",
          phase: "end",
          status: "expired",
          iteration: pending.iteration,
          content: timeoutError.message,
          originChannel: pending.originChannel,
          originChatId: pending.originChatId,
          metadata: {
            approvalId,
            ...(pending.originMessageId
              ? {
                  message_id: pending.originMessageId,
                }
              : {}),
          },
        });
      }
      timeoutReject(timeoutError);
      void this.bus.emitSubagentApprovalExpired({
        type: "SUBAGENT_APPROVAL_EXPIRED",
        approvalId,
        taskId: options.taskId,
        expiredAt: new Date(),
        reason: timeoutError.message,
      });
    }, hitl.approvalTimeoutMs);

    const pendingApproval: PendingApproval = {
      approvalId,
      taskId: options.taskId,
      sessionKey: options.sessionKey,
      timer: timeoutTimer,
      resolve: resolveApproval,
      reject: rejectApproval,
      spanId: approvalSpanId,
      parentSpanId: options.parentSpanId,
      originChannel: options.originChannel,
      originChatId: options.originChatId,
      originMessageId: options.originMessageId,
      runId: options.taskId,
      iteration: options.iteration,
      agentId,
      agentName,
    };
    this.pendingApprovals.set(approvalId, pendingApproval);
    if (!this.taskToApprovals.has(options.taskId)) {
      this.taskToApprovals.set(options.taskId, new Set());
    }
    this.taskToApprovals.get(options.taskId)?.add(approvalId);

    try {
      if (this.traceEnabled()) {
        await this.emitSubagentTraceEvent({
          runId: options.taskId,
          spanId: approvalSpanId,
          parentSpanId: options.parentSpanId,
          agentId,
          agentName,
          eventType: "approval",
          phase: "start",
          status: "requested",
          iteration: options.iteration,
          content: `Approval requested for ${approvalToolCalls.length} tool call(s).`,
          originChannel: options.originChannel,
          originChatId: options.originChatId,
          metadata: {
            approvalId,
            commandPreview,
            ...(options.originMessageId
              ? {
                  message_id: options.originMessageId,
                }
              : {}),
          },
        });
      }
      await this.bus.emitSubagentApprovalRequested({
        type: "SUBAGENT_APPROVAL_REQUESTED",
        approvalId,
        taskId: options.taskId,
        runId: workflowContext.runId,
        nodeId: workflowContext.nodeId,
        nodeName: workflowContext.nodeName,
        approvalTarget: hitl.approvalTarget,
        requestedAt,
        expiresAt,
        toolCalls: approvalToolCalls,
        commandPreview,
        originChannel: options.originChannel,
        originChatId: options.originChatId,
      });
    } catch (error) {
      const pending = this.takePendingApproval(approvalId);
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Approval request failed to emit."));
      }
      throw error;
    }

    if (options.signal.aborted) {
      const pending = this.takePendingApproval(approvalId);
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Subagent aborted before approval."));
      }
      throw new Error("Subagent aborted");
    }

    await Promise.race([waitApprovalPromise, timeoutPromise]);
  }

  private async buildSubagentPrompt(
    roleConfig: RoleConfig | null,
    taskWorkspace: string,
    skillNames: string[],
  ): Promise<string> {
    const timeCtx = new ContextBuilder(taskWorkspace).buildRuntimeContext();
    const parts: string[] = [];
    if (roleConfig) {
      parts.push(`# Subagent

${timeCtx}

${roleConfig.systemPrompt}

## Workspace
${taskWorkspace}`);
    } else {
      parts.push(`# Subagent

${timeCtx}

You are a subagent spawned by the main agent to complete a specific task.
Stay focused on the assigned task. Your final response will be reported back to the main agent.

## Workspace
${taskWorkspace}`);
    }

    if (skillNames.length > 0) {
      const loaded = await new SkillsLoader(this.workspace).loadSkillsForContext(skillNames);
      const listedSkills = skillNames.join(", ");
      if (loaded) {
        parts.push(`## Assigned Skills

Focus on these skills for this task: ${listedSkills}

${loaded}`);
      } else {
        parts.push(`## Assigned Skills

Focus on these skills for this task: ${listedSkills}`);
      }
    }

    return parts.join("\n\n");
  }

  private async runSubagent(options: {
    taskId: string;
    role: string | null;
    roleConfig: RoleConfig | null;
    label: string;
    task: string;
    originChannel: string;
    originChatId: string;
    originMessageId?: string;
    sessionKey: string;
    skillNames: string[];
    announceToMainAgent: boolean;
    workflowContext?: SpawnTaskOptions["workflowContext"];
    signal: AbortSignal;
  }): Promise<void> {
    const messageLogs: SubagentTaskMessage[] = [];
    const toolCallLogs: SubagentTaskToolCall[] = [];
    const runId = options.taskId;
    const runSpanId = this.newTraceSpanId();
    const agentId = options.taskId;
    const agentName = options.label || options.taskId;
    const traceMessageMeta =
      typeof options.originMessageId === "string" && options.originMessageId.trim().length > 0
        ? { message_id: options.originMessageId }
        : {};
    await this.acquireSlot();

    try {
      const taskWorkspace =
        options.roleConfig?.workspaceIsolation === true
          ? path.join(this.workspace, "tasks", options.taskId)
          : this.workspace;

      if (options.roleConfig?.workspaceIsolation === true) {
        await mkdir(taskWorkspace, { recursive: true });
      }

      const tools = this.buildToolRegistry({
        roleConfig: options.roleConfig,
        taskWorkspace,
        originChannel: options.originChannel,
        originChatId: options.originChatId,
      });

      const systemPrompt = await this.buildSubagentPrompt(
        options.roleConfig,
        taskWorkspace,
        options.skillNames,
      );

      const messages: Array<Record<string, unknown>> = [
        {
          role: "system",
          content: systemPrompt,
        },
        { role: "user", content: options.task },
      ];
      messageLogs.push(
        {
          role: "system",
          content: truncateLogContent(systemPrompt),
          at: nowIso(),
        },
        {
          role: "user",
          content: truncateLogContent(options.task),
          at: nowIso(),
        },
      );

      let finalResult: string | null = null;
      const highRiskSet = new Set(options.workflowContext?.hitl?.highRiskTools ?? []);
      const maxIterations = options.roleConfig?.maxIterations ?? 15;
      if (this.traceEnabled()) {
        await this.emitSubagentTraceEvent({
          runId,
          spanId: runSpanId,
          parentSpanId: null,
          agentId,
          agentName,
          eventType: "run",
          phase: "start",
          status: "running",
          content: "Subagent run started.",
          originChannel: options.originChannel,
          originChatId: options.originChatId,
          metadata: {
            ...traceMessageMeta,
            role: options.role,
          },
        });
      }
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        if (options.signal.aborted) {
          throw new Error("Subagent aborted");
        }
        const iterationNumber = iteration + 1;
        const iterationSpanId = this.newTraceSpanId();
        if (this.traceEnabled()) {
          await this.emitSubagentTraceEvent({
            runId,
            spanId: iterationSpanId,
            parentSpanId: runSpanId,
            agentId,
            agentName,
            eventType: "iteration",
            phase: "start",
            status: "running",
            iteration: iterationNumber,
            content: `Iteration ${iterationNumber} started.`,
            originChannel: options.originChannel,
            originChatId: options.originChatId,
            metadata: traceMessageMeta,
          });
        }
        const response = await this.provider.chat({
          messages,
          tools: tools.getDefinitions(),
          model: this.model,
          temperature: this.temperature,
          maxTokens: this.maxTokens,
          reasoningEffort: this.reasoningEffort,
          signal: options.signal,
        });

        if (response.toolCalls.length === 0) {
          finalResult = response.content ?? "Task completed with no output.";
          if (this.traceEnabled()) {
            await this.emitSubagentTraceEvent({
              runId,
              spanId: this.newTraceSpanId(),
              parentSpanId: iterationSpanId,
              agentId,
              agentName,
              eventType: "result",
              phase: "end",
              status: "ok",
              iteration: iterationNumber,
              content: truncateLogContent(finalResult),
              originChannel: options.originChannel,
              originChatId: options.originChatId,
              metadata: traceMessageMeta,
            });
          }
          messageLogs.push({
            role: "assistant",
            content: truncateLogContent(finalResult),
            at: nowIso(),
          });
          break;
        }

        const toolCallDicts = response.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        }));
        messages.push({
          role: "assistant",
          content: response.content ?? "",
          tool_calls: toolCallDicts,
        });
        if (response.content && this.traceEnabled("verbose")) {
          await this.emitSubagentTraceEvent({
            runId,
            spanId: this.newTraceSpanId(),
            parentSpanId: iterationSpanId,
            agentId,
            agentName,
            eventType: "intent",
            phase: "update",
            status: "info",
            iteration: iterationNumber,
            content: truncateLogContent(response.content),
            originChannel: options.originChannel,
            originChatId: options.originChatId,
            metadata: traceMessageMeta,
          });
        }
        messageLogs.push({
          role: "assistant",
          content: truncateLogContent(response.content ?? ""),
          at: nowIso(),
        });

        const hitl = options.workflowContext?.hitl;
        if (hitl?.enabled) {
          const hasHighRisk = response.toolCalls.some((toolCall) =>
            highRiskSet.has(toolCall.name),
          );
          if (hasHighRisk) {
            await this.waitForApproval({
              taskId: options.taskId,
              label: options.label,
              sessionKey: options.sessionKey,
              originChannel: options.originChannel,
              originChatId: options.originChatId,
              workflowContext: options.workflowContext,
              originMessageId: options.originMessageId,
              toolCalls: response.toolCalls,
              signal: options.signal,
              iteration: iterationNumber,
              parentSpanId: iterationSpanId,
            });
          }
        }

        for (const toolCall of response.toolCalls) {
          const toolSpanId = this.newTraceSpanId();
          if (this.traceEnabled()) {
            await this.emitSubagentTraceEvent({
              runId,
              spanId: toolSpanId,
              parentSpanId: iterationSpanId,
              agentId,
              agentName,
              eventType: "tool_call",
              phase: "start",
              status: "running",
              iteration: iterationNumber,
              content: `${toolCall.name}(${JSON.stringify(toolCall.arguments).slice(0, 180)})`,
              originChannel: options.originChannel,
              originChatId: options.originChatId,
              metadata: {
                ...traceMessageMeta,
                toolName: toolCall.name,
              },
            });
          }
          const result = await tools.execute(toolCall.name, toolCall.arguments, {
            signal: options.signal,
          });
          const resultText = truncateLogContent(result);
          const loggedAt = nowIso();
          if (this.traceEnabled()) {
            await this.emitSubagentTraceEvent({
              runId,
              spanId: this.newTraceSpanId(),
              parentSpanId: toolSpanId,
              agentId,
              agentName,
              eventType: "result",
              phase: "end",
              status: result.startsWith("Error:") ? "error" : "ok",
              iteration: iterationNumber,
              content: `${toolCall.name} -> ${truncateLogContent(result).slice(0, 220)}`,
              originChannel: options.originChannel,
              originChatId: options.originChatId,
              metadata: traceMessageMeta,
            });
          }
          toolCallLogs.push({
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
            result: resultText,
            highRisk: highRiskSet.has(toolCall.name),
            at: loggedAt,
          });
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.name,
            content: sanitizeToolResultForContext(toolCall.name, result),
          });
          messageLogs.push({
            role: "tool",
            name: toolCall.name,
            toolCallId: toolCall.id,
            content: resultText,
            at: loggedAt,
          });
        }
      }

      if (!finalResult) {
        finalResult = "Task completed but no final response was generated.";
      }

      if (this.traceEnabled()) {
        await this.emitSubagentTraceEvent({
          runId,
          spanId: this.newTraceSpanId(),
          parentSpanId: runSpanId,
          agentId,
          agentName,
          eventType: "run",
          phase: "end",
          status: "ok",
          content: truncateLogContent(finalResult).slice(0, 220),
          originChannel: options.originChannel,
          originChatId: options.originChatId,
          metadata: traceMessageMeta,
        });
      }

      await this.announceResult({
        taskId: options.taskId,
        role: options.role,
        label: options.label,
        task: options.task,
        result: finalResult,
        status: "ok",
        originChannel: options.originChannel,
        originChatId: options.originChatId,
        announceToMainAgent: options.announceToMainAgent,
        messages: messageLogs,
        toolCalls: toolCallLogs,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      try {
        const errorResult = `Error: ${msg}`;
        if (this.traceEnabled()) {
          await this.emitSubagentTraceEvent({
            runId,
            spanId: this.newTraceSpanId(),
            parentSpanId: runSpanId,
            agentId,
            agentName,
            eventType: "run",
            phase: "end",
            status: "error",
            content: truncateLogContent(errorResult).slice(0, 220),
            originChannel: options.originChannel,
            originChatId: options.originChatId,
            metadata: traceMessageMeta,
          });
        }
        messageLogs.push({
          role: "assistant",
          content: truncateLogContent(errorResult),
          at: nowIso(),
        });
        await this.announceResult({
          taskId: options.taskId,
          role: options.role,
          label: options.label,
          task: options.task,
          result: errorResult,
          status: "error",
          originChannel: options.originChannel,
          originChatId: options.originChatId,
          announceToMainAgent: options.announceToMainAgent,
          messages: messageLogs,
          toolCalls: toolCallLogs,
        });
      } catch (announceError) {
        const announceMessage =
          announceError instanceof Error ? announceError.message : String(announceError);
        console.warn(
          `[subagent] failed to announce task ${options.taskId}: ${announceMessage}`,
        );
      }
    } finally {
      this.releaseSlot();
    }
  }

  private async announceResult(options: {
    taskId: string;
    role: string | null;
    label: string;
    task: string;
    result: string;
    status: "ok" | "error";
    originChannel: string;
    originChatId: string;
    announceToMainAgent: boolean;
    messages?: SubagentTaskMessage[];
    toolCalls?: SubagentTaskToolCall[];
  }): Promise<void> {
    const event: SubagentTaskEvent = {
      type:
        options.status === "ok"
          ? "SUBAGENT_TASK_COMPLETED"
          : "SUBAGENT_TASK_FAILED",
      taskId: options.taskId,
      role: options.role,
      label: options.label,
      task: options.task,
      status: options.status,
      result: options.result,
      messages: options.messages,
      toolCalls: options.toolCalls,
      originChannel: options.originChannel,
      originChatId: options.originChatId,
      timestamp: new Date(),
    };
    await this.bus.emitSubagentEvent(event);

    if (!options.announceToMainAgent) {
      return;
    }

    const statusText =
      options.status === "ok" ? "completed successfully" : "failed";
    const roleTag = options.role ? ` (role: ${options.role})` : "";
    const content = `[Subagent '${options.label}'${roleTag} ${statusText}]

Task: ${options.task}

Result:
${options.result}

Summarize this naturally for the user. Keep it brief (1-2 sentences). Do not mention technical details like "subagent" or task IDs.`;

    const msg: InboundMessage = {
      channel: "system",
      senderId: "subagent",
      chatId: `${options.originChannel}:${options.originChatId}`,
      content,
    };
    await this.bus.publishInbound(msg);
  }
}
