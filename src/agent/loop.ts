import { randomUUID } from "node:crypto";
import path from "node:path";

import { ContextBuilder } from "./context/context-builder.js";
import { MemoryConsolidator } from "./memory/consolidator.js";
import { MemUClient } from "./memory/memu-client.js";
import { MemoryStore } from "./memory/store.js";
import { SubagentManager } from "./subagent/manager.js";
import { Session, SessionStore, type SessionMessage } from "./session/session-store.js";
import type { InboundMessage, OutboundMessage } from "../bus/events.js";
import { getSessionKey } from "../bus/events.js";
import { MessageBus } from "../bus/message-bus.js";
import type { CronService } from "../cron/service.js";
import type { LLMProvider, ToolCallRequest } from "../llm/provider.js";
import { CronTool } from "../tools/builtins/cron.js";
import { EditFileTool, ListDirTool, ReadFileTool, WriteFileTool } from "../tools/builtins/filesystem.js";
import { MessageTool } from "../tools/builtins/message.js";
import { ExecTool } from "../tools/builtins/exec.js";
import { SpawnTool } from "../tools/builtins/spawn.js";
import {
  DraftWorkflowTool,
  QueryWorkflowStatusTool,
  TriggerWorkflowTool,
} from "../tools/builtins/workflow.js";
import { WebFetchTool, WebSearchTool } from "../tools/builtins/web.js";
import { MemoryDeleteTool, MemoryRetrieveTool, MemorySaveTool } from "../tools/builtins/memory.js";
import { ToolRegistry } from "../tools/core/tool-registry.js";
import { Mutex } from "../utils/mutex.js";
import { DEFAULT_CONFIG, type AppConfig, type McpConfig, type MemoryConfig } from "../config/schema.js";
import { McpManager } from "../mcp/mcp-manager.js";
import { WorkflowEngine, type WorkflowRunSnapshot } from "../workflow/engine.js";
import { WorkflowRunActivityHistoryRepository } from "../workflow/run-activity-history.js";
import { WorkflowRepository } from "../workflow/repository.js";
import { WorkflowRunHistoryRepository } from "../workflow/run-history.js";
import { recoverRunSnapshot } from "../workflow/run-recovery.js";
import { RuntimeSqliteStore } from "../workflow/runtime-sqlite.js";

const TOOL_RESULT_MAX_CHARS = 500;
const WORKFLOW_STATUS_POLL_LIMIT = 4;

interface RunResult {
  finalContent: string | null;
  toolsUsed: string[];
  messages: Array<Record<string, unknown>>;
}

interface ActiveTask {
  promise: Promise<void>;
  abortController: AbortController;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export interface AgentLoopOptions {
  bus: MessageBus;
  provider: LLMProvider;
  workspace: string;
  model?: string;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
  memoryWindow?: number;
  reasoningEffort?: string | null;
  restrictToWorkspace?: boolean;
  execTimeoutSeconds?: number;
  webSearchApiKey?: string;
  webSearchMaxResults?: number;
  webProxy?: string | null;
  cronService?: CronService;
  enableSpawn?: boolean;
  channelsConfig?: {
    sendProgress: boolean;
    sendToolHints: boolean;
  };
  sessionStore?: SessionStore;
  mcpConfig?: McpConfig;
  memoryConfig?: MemoryConfig;
  appConfig?: AppConfig;
}

export class AgentLoop {
  readonly bus: MessageBus;
  readonly provider: LLMProvider;
  readonly workspace: string;
  readonly model: string;
  readonly maxIterations: number;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly memoryWindow: number;
  readonly reasoningEffort: string | null;
  readonly restrictToWorkspace: boolean;
  readonly context: ContextBuilder;
  readonly sessions: SessionStore;
  readonly tools: ToolRegistry;
  readonly channelsConfig?: {
    sendProgress: boolean;
    sendToolHints: boolean;
  };
  readonly cronService?: CronService;
  readonly enableSpawn: boolean;
  readonly workflowEngine: WorkflowEngine;
  readonly workflowRepository: WorkflowRepository;
  readonly workflowRunHistory: WorkflowRunHistoryRepository;
  readonly workflowRunActivityHistory: WorkflowRunActivityHistoryRepository;
  readonly runtimeStore: RuntimeSqliteStore;
  readonly gatewayHost: string;
  readonly gatewayPort: number;

  private running = false;
  private readonly processingLock = new Mutex();
  private readonly activeTasks = new Map<string, Set<ActiveTask>>();
  private readonly memory: MemoryStore;
  private readonly consolidator: MemoryConsolidator;
  private readonly consolidating = new Set<string>();
  private readonly consolidationLocks = new Map<string, Mutex>();
  private readonly execTimeoutSeconds: number;
  private readonly webSearchApiKey: string;
  private readonly webSearchMaxResults: number;
  private readonly webProxy: string | null;
  private readonly subagents: SubagentManager;
  private readonly mcpManager = new McpManager();
  private readonly mcpConfig?: McpConfig;
  private readonly memuClient: MemUClient | null;
  private readonly memuRetrieveEnabled: boolean;
  private readonly memuMemorizeEnabled: boolean;
  private readonly memuMemorizeMode: "auto" | "tool";
  private readonly memuAgentId: string;
  private readonly memuScopes: { chat: string; papers: string };
  private readonly workflowTraceCursor = new Map<
    string,
    {
      status: WorkflowRunSnapshot["status"];
      nodes: Map<string, { status: string; attempt: number; currentTaskId: string | null }>;
    }
  >();

  constructor(options: AgentLoopOptions) {
    this.bus = options.bus;
    this.provider = options.provider;
    this.workspace = path.resolve(options.workspace);
    this.model = options.model ?? this.provider.getDefaultModel();
    this.maxIterations = options.maxIterations ?? 40;
    this.temperature = options.temperature ?? 0.1;
    this.maxTokens = options.maxTokens ?? 4096;
    this.memoryWindow = options.memoryWindow ?? 100;
    this.reasoningEffort = options.reasoningEffort ?? null;
    this.restrictToWorkspace = options.restrictToWorkspace ?? false;
    this.execTimeoutSeconds = options.execTimeoutSeconds ?? 60;
    this.webSearchApiKey = options.webSearchApiKey ?? "";
    this.webSearchMaxResults = options.webSearchMaxResults ?? 5;
    this.webProxy = options.webProxy ?? null;
    this.cronService = options.cronService;
    this.enableSpawn = options.enableSpawn ?? true;
    this.channelsConfig = options.channelsConfig;

    this.context = new ContextBuilder(this.workspace);
    this.memory = new MemoryStore(this.workspace);
    this.consolidator = new MemoryConsolidator(this.memory);
    this.sessions = options.sessionStore ?? new SessionStore(this.workspace);
    this.tools = new ToolRegistry();
    const memuConfig = options.memoryConfig?.memu;
    const memuApiStyle = memuConfig?.apiStyle ?? "cloudV3";
    const requiresMemuApiKey = memuApiStyle === "cloudV3";
    const memuEnabled =
      memuConfig?.enabled === true && (!requiresMemuApiKey || Boolean(memuConfig.apiKey.trim()));
    this.memuClient = memuEnabled
      ? new MemUClient({
          apiKey: memuConfig?.apiKey ?? "",
          baseUrl: memuConfig?.baseUrl ?? "https://api.memu.so",
          timeoutMs: memuConfig?.timeoutMs ?? 15_000,
          apiStyle: memuConfig?.apiStyle ?? "cloudV3",
          endpoints: memuConfig?.endpoints ?? {},
        })
      : null;
    this.memuRetrieveEnabled = memuEnabled && (memuConfig?.retrieve ?? true);
    this.memuMemorizeEnabled = memuEnabled && (memuConfig?.memorize ?? true);
    this.memuMemorizeMode = memuConfig?.memorizeMode ?? "tool";
    this.memuAgentId = memuConfig?.agentId?.trim() || "openintern";
    this.memuScopes = {
      chat: memuConfig?.scopes?.chat?.trim() || "chat",
      papers: memuConfig?.scopes?.papers?.trim() || "papers",
    };

    const appConfigRef = options.appConfig ?? structuredClone(DEFAULT_CONFIG);
    this.subagents = new SubagentManager({
      provider: this.provider,
      workspace: this.workspace,
      bus: this.bus,
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      reasoningEffort: this.reasoningEffort,
      webSearchApiKey: this.webSearchApiKey,
      webSearchMaxResults: this.webSearchMaxResults,
      webProxy: this.webProxy,
      execTimeoutSeconds: this.execTimeoutSeconds,
      restrictToWorkspace: this.restrictToWorkspace,
      config: appConfigRef,
      memuClient: this.memuClient,
      memuScopeResolver: ({ channel, chatId, scope }) => this.memuScope(channel, chatId, scope),
      maxConcurrent: appConfigRef.agents.subagentConcurrency.maxConcurrent,
      externalToolRegistry: this.tools,
    });
    this.workflowRunHistory = new WorkflowRunHistoryRepository(this.workspace);
    this.workflowRunActivityHistory = new WorkflowRunActivityHistoryRepository(this.workspace);
    this.runtimeStore = new RuntimeSqliteStore(this.workspace);
    if (!this.runtimeStore.available) {
      // Keep agent running even when node:sqlite is unavailable.
      process.stderr.write(
        "Runtime SQLite unavailable (node:sqlite not supported in current Node). Agent will continue without SQLite persistence.\n",
      );
    }
    this.workflowEngine = new WorkflowEngine({
      bus: this.bus,
      subagents: this.subagents,
      workspace: this.workspace,
      config: appConfigRef,
      onSnapshot: async (snapshot) => {
        await this.workflowRunHistory.save(snapshot);
        this.runtimeStore.upsertRun(snapshot);
        const prev = this.workflowTraceCursor.get(snapshot.runId);
        if (!prev || prev.status !== snapshot.status) {
          const statusDetails =
            snapshot.status === "failed" && snapshot.error
              ? `${prev ? `${prev.status} -> ${snapshot.status}` : `status=${snapshot.status}`}; error=${shortTraceText(snapshot.error)}`
              : prev
                ? `${prev.status} -> ${snapshot.status}`
                : `status=${snapshot.status}`;
          this.runtimeStore.upsertTrace({
            id: `trace_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
            timestamp: new Date().toISOString(),
            runId: snapshot.runId,
            type: "run.status.changed",
            title: "Run status changed",
            details: statusDetails,
            status:
              snapshot.status === "failed"
                ? "failed"
                : snapshot.status === "waiting_for_approval"
                  ? "pending"
                  : "ok",
          });
        }

        const prevNodes = prev?.nodes ?? new Map<string, { status: string; attempt: number; currentTaskId: string | null }>();
        for (const node of snapshot.nodes) {
          const old = prevNodes.get(node.id);
          if (!old || old.status !== node.status || old.attempt !== node.attempt || old.currentTaskId !== node.currentTaskId) {
            const nodeDetailsBase = old
              ? `${old.status} -> ${node.status} (attempt ${node.attempt}/${node.maxAttempts})`
              : `${node.status} (attempt ${node.attempt}/${node.maxAttempts})`;
            const nodeDetails =
              node.status === "failed" && node.lastError
                ? `${nodeDetailsBase}; error=${shortTraceText(node.lastError)}`
                : nodeDetailsBase;
            this.runtimeStore.upsertTrace({
              id: `trace_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
              timestamp: new Date().toISOString(),
              runId: snapshot.runId,
              type: "node.status.changed",
              title: `Node ${node.id} status changed`,
              details: nodeDetails,
              status:
                node.status === "failed"
                  ? "failed"
                  : node.status === "waiting_for_approval"
                    ? "pending"
                    : "ok",
              meta: {
                nodeId: node.id,
              },
            });
          }
        }
        this.workflowTraceCursor.set(snapshot.runId, {
          status: snapshot.status,
          nodes: new Map(
            snapshot.nodes.map((node) => [
              node.id,
              {
                status: node.status,
                attempt: node.attempt,
                currentTaskId: node.currentTaskId,
              },
            ]),
          ),
        });
      },
      onActivity: async (activity) => {
        await this.workflowRunActivityHistory.append(activity.runId, activity);
        this.runtimeStore.upsertActivity(activity);
        const toolNames = activity.toolCalls
          .map((item) => item.name.trim())
          .filter((item) => item.length > 0)
          .join(", ");
        const errorText =
          activity.type === "subagent.task.failed" || activity.status === "error"
            ? shortTraceText(activity.result)
            : "";
        const detailParts = [`taskId=${activity.taskId}`, `label=${activity.label}`];
        if (toolNames) {
          detailParts.push(`tools=${toolNames}`);
        }
        if (errorText) {
          detailParts.push(`error=${errorText}`);
        }
        this.runtimeStore.upsertTrace({
          id: `trace_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
          timestamp: activity.timestamp,
          runId: activity.runId,
          type: activity.type,
          title:
            activity.type === "subagent.task.completed"
              ? "Subagent task completed"
              : "Subagent task failed",
          details: detailParts.join("; "),
          status: activity.type === "subagent.task.completed" ? "ok" : "failed",
          meta: {
            taskId: activity.taskId,
            nodeId: activity.nodeId,
            ...(errorText ? { error: errorText } : {}),
          },
        });
      },
    });
    this.workflowRepository = new WorkflowRepository(this.workspace);
    this.gatewayHost = appConfigRef.gateway.host;
    this.gatewayPort = appConfigRef.gateway.port;

    this.registerDefaultTools();
    this.mcpConfig = options.mcpConfig;
  }

  private registerDefaultTools(): void {
    const allowedDir = this.restrictToWorkspace ? this.workspace : undefined;
    this.tools.register(new ReadFileTool(this.workspace, allowedDir));
    this.tools.register(new WriteFileTool(this.workspace, allowedDir));
    this.tools.register(new EditFileTool(this.workspace, allowedDir));
    this.tools.register(new ListDirTool(this.workspace, allowedDir));
    this.tools.register(
      new ExecTool({
        timeoutMs: this.execTimeoutSeconds * 1000,
        workingDir: this.workspace,
        restrictToWorkspace: this.restrictToWorkspace,
      }),
    );
    this.tools.register(new WebSearchTool(this.webSearchApiKey, this.webSearchMaxResults, this.webProxy));
    this.tools.register(new WebFetchTool(50_000, this.webProxy));
    this.tools.register(new MessageTool((msg) => this.bus.publishOutbound(msg)));
    if (this.enableSpawn) {
      this.tools.register(new SpawnTool(this.subagents));
    }
    if (this.cronService) {
      this.tools.register(new CronTool(this.cronService));
    }
    this.tools.register(
      new TriggerWorkflowTool(this.workflowEngine, this.workflowRepository),
    );
    this.tools.register(
      new QueryWorkflowStatusTool(this.workflowEngine, {
        load: async (runId: string) => {
          const snapshot =
            this.runtimeStore.getRun(runId) ?? (await this.workflowRunHistory.load(runId));
          if (!snapshot) {
            return null;
          }
          const recovered = recoverRunSnapshot(snapshot);
          if (recovered.recovered) {
            this.runtimeStore.upsertRun(recovered.snapshot);
            await this.workflowRunHistory.save(recovered.snapshot);
          }
          return recovered.snapshot;
        },
      }),
    );
    this.tools.register(
      new DraftWorkflowTool(
        this.workflowRepository,
        this.gatewayHost,
        this.gatewayPort,
        process.env.OPENINTERN_UI_PUBLIC_BASE,
      ),
    );
    if (this.memuClient) {
      const resolveScope = (params: {
        channel: string;
        chatId: string;
        scope: "chat" | "papers";
      }): { userId: string; agentId: string } =>
        this.memuScope(params.channel, params.chatId, params.scope);
      if (this.memuRetrieveEnabled) {
        this.tools.register(new MemoryRetrieveTool(this.memuClient, resolveScope));
      }
      if (this.memuMemorizeEnabled) {
        this.tools.register(new MemorySaveTool(this.memuClient, resolveScope));
        this.tools.register(new MemoryDeleteTool(this.memuClient, resolveScope));
      }
    }
  }

  stop(): void {
    this.running = false;
    this.workflowEngine.close();
    this.runtimeStore.close();
    void this.mcpManager.closeAll();
  }

  async initMcp(): Promise<void> {
    if (this.mcpConfig && Object.keys(this.mcpConfig.servers).length > 0) {
      await this.mcpManager.connectAll(this.mcpConfig, this.tools);
    }
  }

  async run(): Promise<void> {
    this.running = true;
    while (this.running) {
      const message = await this.bus.consumeInbound(1000);
      if (!message) {
        continue;
      }

      const command = message.content.trim().toLowerCase();
      if (command === "/stop") {
        await this.handleStop(message);
        continue;
      }

      const abortController = new AbortController();
      const sessionKey = getSessionKey(message);
      const active: ActiveTask = {
        abortController,
        promise: this.dispatch(message, abortController.signal).finally(() => {
          const set = this.activeTasks.get(sessionKey);
          if (!set) {
            return;
          }
          set.delete(active);
          if (set.size === 0) {
            this.activeTasks.delete(sessionKey);
          }
        }),
      };

      if (!this.activeTasks.has(sessionKey)) {
        this.activeTasks.set(sessionKey, new Set());
      }
      this.activeTasks.get(sessionKey)?.add(active);
    }
  }

  private async dispatch(message: InboundMessage, signal: AbortSignal): Promise<void> {
    await this.processingLock.runExclusive(async () => {
      try {
        const response = await this.processMessage(message, undefined, signal);
        if (response) {
          await this.bus.publishOutbound(response);
        } else if (message.channel === "cli") {
          await this.bus.publishOutbound({
            channel: message.channel,
            chatId: message.chatId,
            content: "",
            metadata: message.metadata ?? {},
          });
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        const msg = error instanceof Error ? error.message : String(error);
        await this.bus.publishOutbound({
          channel: message.channel,
          chatId: message.chatId,
          content: `Sorry, I encountered an error. (${msg})`,
        });
      }
    });
  }

  private async handleStop(message: InboundMessage): Promise<void> {
    const sessionKey = getSessionKey(message);
    const tasks = Array.from(this.activeTasks.get(sessionKey) ?? []);
    this.activeTasks.delete(sessionKey);
    for (const task of tasks) {
      task.abortController.abort();
    }
    await Promise.allSettled(tasks.map((t) => t.promise));
    const subCancelled = await this.subagents.cancelBySession(sessionKey);

    const count = tasks.length + subCancelled;
    await this.bus.publishOutbound({
      channel: message.channel,
      chatId: message.chatId,
      content: count > 0 ? `Stopped ${count} task(s).` : "No active task to stop.",
    });
  }

  async processDirect(options: {
    content: string;
    sessionKey?: string;
    channel?: string;
    chatId?: string;
    onProgress?: (content: string, meta?: { toolHint?: boolean }) => Promise<void>;
    signal?: AbortSignal;
  }): Promise<string> {
    const msg: InboundMessage = {
      channel: options.channel ?? "cli",
      senderId: "user",
      chatId: options.chatId ?? "direct",
      content: options.content,
      metadata: {},
    };

    const response = await this.processMessage(
      msg,
      options.sessionKey,
      options.signal,
      options.onProgress,
    );
    return response?.content ?? "";
  }

  private setToolContext(channel: string, chatId: string, messageId?: string): void {
    for (const toolName of this.tools.names) {
      const tool = this.tools.get(toolName);
      if (!tool) {
        continue;
      }
      if (toolName === "message" && tool instanceof MessageTool) {
        tool.setContext(channel, chatId, messageId);
        continue;
      }
      if (toolName !== "message" && "setContext" in tool && typeof tool.setContext === "function") {
        tool.setContext(channel, chatId);
      }
    }
  }

  private static stripThink(text: string | null): string | null {
    if (!text) {
      return null;
    }
    const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return cleaned.length > 0 ? cleaned : null;
  }

  private static toolHint(toolCalls: ToolCallRequest[]): string {
    const parts = toolCalls.map((tc) => {
      const values = Object.values(tc.arguments ?? {});
      const value = values.length > 0 ? values[0] : null;
      if (typeof value !== "string") {
        return tc.name;
      }
      return value.length > 40 ? `${tc.name}("${value.slice(0, 40)}...")` : `${tc.name}("${value}")`;
    });
    return parts.join(", ");
  }

  private static workflowProgressFromToolResult(
    toolName: string,
    result: string,
  ): { message: string; status: string | null } | null {
    if (typeof result !== "string" || result.trim().length === 0) {
      return null;
    }

    try {
      const parsed = JSON.parse(result) as unknown;
      if (!isObject(parsed)) {
        return null;
      }

      if (toolName === "trigger_workflow") {
        const instanceId =
          typeof parsed.instance_id === "string" && parsed.instance_id.trim().length > 0
            ? parsed.instance_id.trim()
            : null;
        const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
        if (!instanceId) {
          return summary ? { message: summary, status: null } : null;
        }
        const message = summary ? `${summary} (instance_id=${instanceId})` : `Workflow started. instance_id=${instanceId}`;
        return { message, status: "running" };
      }

      if (toolName !== "query_workflow_status") {
        return null;
      }
      const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "Workflow status updated.";
      const snapshot = isObject(parsed.snapshot) ? parsed.snapshot : null;
      const status = snapshot && typeof snapshot.status === "string" ? snapshot.status : null;
      const flow = isObject(parsed.execution_flow) ? parsed.execution_flow : null;
      const completed = flow && typeof flow.completed === "number" ? flow.completed : null;
      const total = flow && Array.isArray(flow.nodes) ? flow.nodes.length : null;
      const waiting =
        flow && typeof flow.waiting_for_approval === "number" ? flow.waiting_for_approval : null;
      const running = flow && typeof flow.running === "number" ? flow.running : null;
      const details: string[] = [];
      if (completed !== null && total !== null) {
        details.push(`${completed}/${total} completed`);
      }
      if (running !== null && running > 0) {
        details.push(`${running} running`);
      }
      if (waiting !== null && waiting > 0) {
        details.push(`${waiting} waiting_for_approval`);
      }
      if (details.length === 0) {
        return { message: summary, status };
      }
      return { message: `${summary} (${details.join(", ")})`, status };
    } catch {
      return null;
    }
  }

  private async runAgentLoop(
    initialMessages: Array<Record<string, unknown>>,
    signal?: AbortSignal,
    onProgress?: (content: string, meta?: { toolHint?: boolean }) => Promise<void>,
  ): Promise<RunResult> {
    let messages = [...initialMessages];
    const toolsUsed: string[] = [];
    let finalContent: string | null = null;
    let iteration = 0;
    const workflowStatusPollCounts = new Map<string, number>();
    let latestWorkflowProgress: string | null = null;

    loop: while (iteration < this.maxIterations) {
      if (signal?.aborted) {
        throw new Error("Request aborted");
      }

      iteration += 1;
      const response = await this.provider.chat({
        messages,
        tools: this.tools.getDefinitions(),
        model: this.model,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        reasoningEffort: this.reasoningEffort,
        signal,
      });

      if (response.toolCalls.length > 0) {
        if (onProgress) {
          await onProgress(AgentLoop.toolHint(response.toolCalls), { toolHint: true });
        }

        const toolCallDicts = response.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
        messages = this.context.addAssistantMessage(
          messages,
          response.content,
          toolCallDicts,
          response.reasoningContent,
          response.thinkingBlocks,
        );

        for (const toolCall of response.toolCalls) {
          if (signal?.aborted) {
            throw new Error("Request aborted");
          }

          if (toolCall.name === "query_workflow_status") {
            const instanceIdRaw = toolCall.arguments?.instance_id;
            const instanceId = typeof instanceIdRaw === "string" ? instanceIdRaw.trim() : "";
            const pollKey = instanceId || JSON.stringify(toolCall.arguments ?? {});
            const nextCount = (workflowStatusPollCounts.get(pollKey) ?? 0) + 1;
            workflowStatusPollCounts.set(pollKey, nextCount);

            if (nextCount > WORKFLOW_STATUS_POLL_LIMIT) {
              finalContent =
                latestWorkflowProgress ??
                `I paused repeated workflow status polling for instance '${instanceId || "unknown"}' after ${WORKFLOW_STATUS_POLL_LIMIT} checks.`;
              if (onProgress) {
                await onProgress(
                  `Polling paused for workflow ${instanceId || "unknown"} after repeated checks. Send another request if you want me to continue polling.`,
                );
              }
              break loop;
            }
          }

          toolsUsed.push(toolCall.name);
          const result = await this.tools.execute(toolCall.name, toolCall.arguments, { signal });
          const workflowProgress = AgentLoop.workflowProgressFromToolResult(toolCall.name, result);
          if (workflowProgress) {
            latestWorkflowProgress = workflowProgress.message;
            if (onProgress) {
              await onProgress(workflowProgress.message);
            }
          }
          messages = this.context.addToolResult(messages, toolCall.id, toolCall.name, result);
        }
      } else {
        const clean = AgentLoop.stripThink(response.content);
        if (response.finishReason === "error") {
          finalContent = clean ?? "Sorry, I encountered an error calling the AI model.";
          break;
        }
        messages = this.context.addAssistantMessage(
          messages,
          clean,
          undefined,
          response.reasoningContent,
          response.thinkingBlocks,
        );
        finalContent = clean;
        break;
      }
    }

    if (finalContent === null && iteration >= this.maxIterations) {
      finalContent = latestWorkflowProgress
        ? `${latestWorkflowProgress}\n\nI reached the maximum number of tool call iterations (${this.maxIterations}). Ask me to continue polling if you still need live updates.`
        : `I reached the maximum number of tool call iterations (${this.maxIterations}) without completing the task. You can try breaking the task into smaller steps.`;
    }

    return { finalContent, toolsUsed, messages };
  }

  private async processMessage(
    message: InboundMessage,
    sessionKey?: string,
    signal?: AbortSignal,
    onProgress?: (content: string, meta?: { toolHint?: boolean }) => Promise<void>,
  ): Promise<OutboundMessage | null> {
    const isSystem = message.channel === "system";
    if (isSystem) {
      const [channel, chatId] = message.chatId.includes(":")
        ? message.chatId.split(":", 2)
        : ["cli", message.chatId];
      const key = `${channel}:${chatId}`;
      const session = await this.sessions.getOrCreate(key);
      this.setToolContext(channel, chatId, this.metadataString(message.metadata, "message_id"));

      const history = session.getHistory(this.memoryWindow);
      const initialMessages = await this.context.buildMessages({
        history,
        currentMessage: message.content,
        channel,
        chatId,
      });
      const result = await this.runAgentLoop(initialMessages, signal);
      this.saveTurn(session, result.messages, 1 + history.length);
      await this.sessions.save(session);
      return {
        channel,
        chatId,
        content: result.finalContent ?? "Background task completed.",
      };
    }

    const key = sessionKey ?? getSessionKey(message);
    const session = await this.sessions.getOrCreate(key);
    const command = message.content.trim().toLowerCase();

    if (command === "/new") {
      const lock = this.getConsolidationLock(session.key);
      this.consolidating.add(session.key);
      try {
        await lock.runExclusive(async () => {
          const snapshot = session.messages.slice(session.lastConsolidated);
          if (snapshot.length === 0) {
            return;
          }
          const temp = new Session(session.key);
          temp.messages = [...snapshot];
          const ok = await this.consolidator.consolidate({
            session: temp,
            provider: this.provider,
            model: this.model,
            archiveAll: true,
            memoryWindow: this.memoryWindow,
          });
          if (!ok) {
            throw new Error("consolidate_failed");
          }
        });
      } catch {
        this.consolidating.delete(session.key);
        return {
          channel: message.channel,
          chatId: message.chatId,
          content: "Memory archival failed, session not cleared. Please try again.",
        };
      }
      this.consolidating.delete(session.key);
      session.clear();
      await this.sessions.save(session);
      this.sessions.invalidate(session.key);
      return {
        channel: message.channel,
        chatId: message.chatId,
        content: "New session started.",
      };
    }
    if (command === "/help") {
      return {
        channel: message.channel,
        chatId: message.chatId,
        content: "Commands:\n/new - Start a new conversation\n/stop - Stop the current task\n/help - Show commands",
      };
    }

    const unconsolidated = session.messages.length - session.lastConsolidated;
    if (unconsolidated >= this.memoryWindow && !this.consolidating.has(session.key)) {
      this.consolidating.add(session.key);
      const lock = this.getConsolidationLock(session.key);
      void lock
        .runExclusive(async () => {
          await this.consolidator.consolidate({
            session,
            provider: this.provider,
            model: this.model,
            memoryWindow: this.memoryWindow,
          });
        })
        .finally(() => {
          this.consolidating.delete(session.key);
        });
    }

    this.setToolContext(message.channel, message.chatId, this.metadataString(message.metadata, "message_id"));
    const messageTool = this.tools.get("message");
    if (messageTool && messageTool instanceof MessageTool) {
      messageTool.startTurn();
    }

    const history = session.getHistory(this.memoryWindow);
    const retrievedMemory = await this.retrieveMemuContext(message);
    const initialMessages = await this.context.buildMessages({
      history,
      currentMessage: message.content,
      retrievedMemory: retrievedMemory ?? undefined,
      media: message.media,
      channel: message.channel,
      chatId: message.chatId,
    });

    const progressHandler =
      onProgress ??
      (async (content: string, meta?: { toolHint?: boolean }) => {
        const isToolHint = meta?.toolHint ?? false;
        if (this.channelsConfig) {
          if (isToolHint && !this.channelsConfig.sendToolHints) {
            return;
          }
          if (!isToolHint && !this.channelsConfig.sendProgress) {
            return;
          }
        }
        await this.bus.publishOutbound({
          channel: message.channel,
          chatId: message.chatId,
          content,
          metadata: {
            ...(message.metadata ?? {}),
            _progress: true,
            _tool_hint: isToolHint,
          },
        });
      });

    const result = await this.runAgentLoop(initialMessages, signal, progressHandler);
    const finalContent =
      result.finalContent ?? "I've completed processing but have no response to give.";

    this.saveTurn(session, result.messages, 1 + history.length);
    await this.sessions.save(session);
    if (this.memuMemorizeMode === "auto") {
      this.scheduleMemuMemorize(message, result.finalContent ?? "");
    }

    if (messageTool && messageTool instanceof MessageTool && messageTool.sentInTurn) {
      return null;
    }

    return {
      channel: message.channel,
      chatId: message.chatId,
      content: finalContent,
      metadata: message.metadata ?? {},
    };
  }

  private saveTurn(session: Session, messages: Array<Record<string, unknown>>, skip: number): void {
    const newMessages = messages.slice(skip);
    for (const m of newMessages) {
      if (typeof m.role !== "string") {
        continue;
      }
      const entry: SessionMessage = { role: m.role, ...m };
      const role = entry.role;
      const content = entry.content;

      if (role === "assistant" && !content && !entry.tool_calls) {
        continue;
      }
      if (role === "tool" && typeof content === "string" && content.length > TOOL_RESULT_MAX_CHARS) {
        entry.content = `${content.slice(0, TOOL_RESULT_MAX_CHARS)}\n... (truncated)`;
      } else if (role === "user") {
        if (
          typeof content === "string" &&
          content.startsWith(ContextBuilder.RUNTIME_CONTEXT_TAG)
        ) {
          continue;
        }
      } else if (role === "system") {
        if (
          typeof content === "string" &&
          content.startsWith(ContextBuilder.EXTERNAL_MEMORY_TAG)
        ) {
          continue;
        }
      }

      if (!entry.timestamp) {
        entry.timestamp = new Date().toISOString();
      }
      session.messages.push(entry);
    }
    session.updatedAt = new Date();
  }

  private metadataString(
    metadata: Record<string, unknown> | undefined,
    key: string,
  ): string | undefined {
    const raw = metadata?.[key];
    return typeof raw === "string" ? raw : undefined;
  }

  private getConsolidationLock(sessionKey: string): Mutex {
    const existing = this.consolidationLocks.get(sessionKey);
    if (existing) {
      return existing;
    }
    const lock = new Mutex();
    this.consolidationLocks.set(sessionKey, lock);
    return lock;
  }

  private memuScope(
    channel: string,
    chatId: string,
    scope: "chat" | "papers" = "chat",
  ): { userId: string; agentId: string } {
    const scopeSuffix = this.memuScopes[scope].trim();
    const agentId = scopeSuffix ? `${this.memuAgentId}:${scopeSuffix}` : this.memuAgentId;
    return {
      userId: `${channel}:${chatId}`,
      agentId,
    };
  }

  private async retrieveMemuContext(message: InboundMessage): Promise<string | null> {
    if (!this.memuClient || !this.memuRetrieveEnabled) {
      return null;
    }
    const query = message.content.trim();
    if (!query || query.startsWith("/")) {
      return null;
    }
    try {
      const result = await this.memuClient.retrieve({
        query,
        ...this.memuScope(message.channel, message.chatId, "chat"),
      });
      return MemUClient.formatRetrieveContext(result);
    } catch (error) {
      this.logMemuWarning("retrieve", error);
      return null;
    }
  }

  private scheduleMemuMemorize(message: InboundMessage, assistantContent: string): void {
    if (!this.memuClient || !this.memuMemorizeEnabled) {
      return;
    }
    const userContent = message.content.trim();
    const assistant = assistantContent.trim();
    if (!userContent || !assistant || userContent.startsWith("/")) {
      return;
    }
    const now = new Date().toISOString();
    const conversation = [
      {
        role: "user",
        content: userContent,
        timestamp: now,
      },
      {
        role: "assistant",
        content: assistant,
        timestamp: now,
      },
    ];
    void this.memuClient
      .memorizeConversation({
        conversation,
        ...this.memuScope(message.channel, message.chatId, "chat"),
      })
      .catch((error) => {
        this.logMemuWarning("memorize", error);
      });
  }

  private logMemuWarning(action: "retrieve" | "memorize", error: unknown): void {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[memu] ${action} failed: ${msg}`);
  }
}
