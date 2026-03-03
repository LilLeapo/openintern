import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { InboundMessage, SubagentTaskEvent } from "../../bus/events.js";
import { MessageBus } from "../../bus/message-bus.js";
import { resolveRole, validateRoleName } from "../../config/role-resolver.js";
import type { AppConfig, RoleConfig } from "../../config/schema.js";
import type { LLMProvider } from "../../llm/provider.js";
import { ExecTool } from "../../tools/builtins/exec.js";
import {
  EditFileTool,
  ListDirTool,
  ReadFileTool,
  WriteFileTool,
} from "../../tools/builtins/filesystem.js";
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
import { ContextBuilder } from "../context/context-builder.js";
import type { MemUClient } from "../memory/memu-client.js";

interface RunningTask {
  task: Promise<void>;
  abortController: AbortController;
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
}

export class SubagentManager {
  private readonly runningTasks = new Map<string, RunningTask>();
  private readonly sessionTasks = new Map<string, Set<string>>();

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

    const configMax = options.config.agents.subagentConcurrency.maxConcurrent;
    const inputMax = options.maxConcurrent ?? configMax;
    const normalized = Number.isFinite(inputMax) ? Math.floor(inputMax) : 1;
    this.maxConcurrent = Math.max(1, normalized);
  }

  async spawn(options: {
    task: string;
    role?: string | null;
    label?: string | null;
    originChannel: string;
    originChatId: string;
    sessionKey: string;
  }): Promise<string> {
    const role = options.role?.trim() ? options.role.trim() : null;
    if (role) {
      const roleError = validateRoleName(this.configRef, role);
      if (roleError) {
        return roleError;
      }
    }

    const roleConfig = role ? resolveRole(this.configRef, role) : null;
    if (role && !roleConfig) {
      return `Error: Role '${role}' is invalid in config.`;
    }

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
      signal: abortController.signal,
    });
    const wrapped: RunningTask = {
      abortController,
      task: runTask.finally(() => {
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

    if (queued && queuePosition !== null) {
      return `Subagent [${label}] queued (id: ${taskId}, position: ${queuePosition} in queue). I'll notify you when it completes.`;
    }
    return `Subagent [${label}] started (id: ${taskId}). I'll notify you when it completes.`;
  }

  async cancelBySession(sessionKey: string): Promise<number> {
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
      if (!createTool) {
        continue;
      }
      const tool = createTool();
      this.setToolContext(tool, options.originChannel, options.originChatId);
      tools.register(tool);
    }

    return tools;
  }

  private buildSubagentPrompt(roleConfig: RoleConfig | null, taskWorkspace: string): string {
    const timeCtx = new ContextBuilder(taskWorkspace).buildRuntimeContext();
    if (roleConfig) {
      return `# Subagent

${timeCtx}

${roleConfig.systemPrompt}

## Workspace
${taskWorkspace}`;
    }
    return `# Subagent

${timeCtx}

You are a subagent spawned by the main agent to complete a specific task.
Stay focused on the assigned task. Your final response will be reported back to the main agent.

## Workspace
${taskWorkspace}`;
  }

  private async runSubagent(options: {
    taskId: string;
    role: string | null;
    roleConfig: RoleConfig | null;
    label: string;
    task: string;
    originChannel: string;
    originChatId: string;
    signal: AbortSignal;
  }): Promise<void> {
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

      const messages: Array<Record<string, unknown>> = [
        {
          role: "system",
          content: this.buildSubagentPrompt(options.roleConfig, taskWorkspace),
        },
        { role: "user", content: options.task },
      ];

      let finalResult: string | null = null;
      const maxIterations = options.roleConfig?.maxIterations ?? 15;
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        if (options.signal.aborted) {
          throw new Error("Subagent aborted");
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

        for (const toolCall of response.toolCalls) {
          const result = await tools.execute(toolCall.name, toolCall.arguments, {
            signal: options.signal,
          });
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.name,
            content: result,
          });
        }
      }

      if (!finalResult) {
        finalResult = "Task completed but no final response was generated.";
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
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      try {
        await this.announceResult({
          taskId: options.taskId,
          role: options.role,
          label: options.label,
          task: options.task,
          result: `Error: ${msg}`,
          status: "error",
          originChannel: options.originChannel,
          originChatId: options.originChatId,
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
      originChannel: options.originChannel,
      originChatId: options.originChatId,
      timestamp: new Date(),
    };
    await this.bus.emitSubagentEvent(event);

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
