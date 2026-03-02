import { randomUUID } from "node:crypto";

import type { InboundMessage } from "../../bus/events.js";
import { MessageBus } from "../../bus/message-bus.js";
import type { LLMProvider } from "../../llm/provider.js";
import { ExecTool } from "../../tools/builtins/exec.js";
import {
  EditFileTool,
  ListDirTool,
  ReadFileTool,
  WriteFileTool,
} from "../../tools/builtins/filesystem.js";
import { WebFetchTool, WebSearchTool } from "../../tools/builtins/web.js";
import { ToolRegistry } from "../../tools/core/tool-registry.js";
import { ContextBuilder } from "../context/context-builder.js";

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
  }

  async spawn(options: {
    task: string;
    label?: string | null;
    originChannel: string;
    originChatId: string;
    sessionKey: string;
  }): Promise<string> {
    const taskId = randomUUID().slice(0, 8);
    const label =
      options.label?.trim() ||
      (options.task.length > 30 ? `${options.task.slice(0, 30)}...` : options.task);

    const abortController = new AbortController();
    const runTask = this.runSubagent({
      taskId,
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
    return this.runningTasks.size;
  }

  private buildSubagentPrompt(): string {
    const timeCtx = new ContextBuilder(this.workspace).buildRuntimeContext();
    return `# Subagent

${timeCtx}

You are a subagent spawned by the main agent to complete a specific task.
Stay focused on the assigned task. Your final response will be reported back to the main agent.

## Workspace
${this.workspace}`;
  }

  private async runSubagent(options: {
    taskId: string;
    label: string;
    task: string;
    originChannel: string;
    originChatId: string;
    signal: AbortSignal;
  }): Promise<void> {
    try {
      const tools = new ToolRegistry();
      const allowedDir = this.restrictToWorkspace ? this.workspace : undefined;
      tools.register(new ReadFileTool(this.workspace, allowedDir));
      tools.register(new WriteFileTool(this.workspace, allowedDir));
      tools.register(new EditFileTool(this.workspace, allowedDir));
      tools.register(new ListDirTool(this.workspace, allowedDir));
      tools.register(
        new ExecTool({
          timeoutMs: this.execTimeoutSeconds * 1000,
          workingDir: this.workspace,
          restrictToWorkspace: this.restrictToWorkspace,
        }),
      );
      tools.register(
        new WebSearchTool(this.webSearchApiKey, this.webSearchMaxResults, this.webProxy),
      );
      tools.register(new WebFetchTool(50_000, this.webProxy));

      const messages: Array<Record<string, unknown>> = [
        { role: "system", content: this.buildSubagentPrompt() },
        { role: "user", content: options.task },
      ];

      let finalResult: string | null = null;
      for (let iteration = 0; iteration < 15; iteration += 1) {
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
        label: options.label,
        task: options.task,
        result: finalResult,
        status: "ok",
        originChannel: options.originChannel,
        originChatId: options.originChatId,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.announceResult({
        label: options.label,
        task: options.task,
        result: `Error: ${msg}`,
        status: "error",
        originChannel: options.originChannel,
        originChatId: options.originChatId,
      });
    }
  }

  private async announceResult(options: {
    label: string;
    task: string;
    result: string;
    status: "ok" | "error";
    originChannel: string;
    originChatId: string;
  }): Promise<void> {
    const statusText =
      options.status === "ok" ? "completed successfully" : "failed";
    const content = `[Subagent '${options.label}' ${statusText}]

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

