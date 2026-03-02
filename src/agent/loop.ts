import path from "node:path";

import { ContextBuilder } from "./context/context-builder.js";
import { MemoryConsolidator } from "./memory/consolidator.js";
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
import { WebFetchTool, WebSearchTool } from "../tools/builtins/web.js";
import { ToolRegistry } from "../tools/core/tool-registry.js";
import { Mutex } from "../utils/mutex.js";

const TOOL_RESULT_MAX_CHARS = 500;

interface RunResult {
  finalContent: string | null;
  toolsUsed: string[];
  messages: Array<Record<string, unknown>>;
}

interface ActiveTask {
  promise: Promise<void>;
  abortController: AbortController;
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
    });

    this.registerDefaultTools();
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
  }

  stop(): void {
    this.running = false;
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
    for (const toolName of ["message", "spawn", "cron"] as const) {
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

  private async runAgentLoop(
    initialMessages: Array<Record<string, unknown>>,
    signal?: AbortSignal,
    onProgress?: (content: string, meta?: { toolHint?: boolean }) => Promise<void>,
  ): Promise<RunResult> {
    let messages = [...initialMessages];
    const toolsUsed: string[] = [];
    let finalContent: string | null = null;
    let iteration = 0;

    while (iteration < this.maxIterations) {
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
          const clean = AgentLoop.stripThink(response.content);
          if (clean) {
            await onProgress(clean);
          }
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
          toolsUsed.push(toolCall.name);
          const result = await this.tools.execute(toolCall.name, toolCall.arguments, { signal });
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
      finalContent =
        `I reached the maximum number of tool call iterations (${this.maxIterations}) ` +
        "without completing the task. You can try breaking the task into smaller steps.";
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
    const initialMessages = await this.context.buildMessages({
      history,
      currentMessage: message.content,
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
}
