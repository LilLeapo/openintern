import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { MessageBus } from "../bus/message-bus.js";
import type { InboundMessage, OutboundMessage } from "../bus/events.js";
import { getSessionKey } from "../bus/events.js";
import type { McpConfig, MemoryConfig } from "../config/schema.js";

export interface SdkAgentOptions {
  bus: MessageBus;
  workspace: string;
  model?: string;
  apiKey: string;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
  restrictToWorkspace?: boolean;
  mcpConfig?: McpConfig;
  memoryConfig?: MemoryConfig;
  channelsConfig?: {
    sendProgress: boolean;
    sendToolHints: boolean;
  };
}

export class SdkAgent {
  readonly bus: MessageBus;
  readonly workspace: string;
  readonly model: string;
  readonly apiKey: string;
  readonly maxIterations: number;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly restrictToWorkspace: boolean;
  readonly mcpConfig?: McpConfig;
  readonly channelsConfig?: {
    sendProgress: boolean;
    sendToolHints: boolean;
  };

  private running = false;
  private readonly activeSessions = new Map<string, AbortController>();
  private readonly sessionIds = new Map<string, string>();

  constructor(options: SdkAgentOptions) {
    this.bus = options.bus;
    this.workspace = options.workspace;
    this.model = options.model ?? "claude-opus-4";
    this.apiKey = options.apiKey;
    this.maxIterations = options.maxIterations ?? 40;
    this.temperature = options.temperature ?? 0.1;
    this.maxTokens = options.maxTokens ?? 4096;
    this.restrictToWorkspace = options.restrictToWorkspace ?? false;
    this.mcpConfig = options.mcpConfig;
    this.channelsConfig = options.channelsConfig;
  }

  stop(): void {
    this.running = false;
    for (const controller of this.activeSessions.values()) {
      controller.abort();
    }
    this.activeSessions.clear();
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

      const sessionKey = getSessionKey(message);
      const abortController = new AbortController();
      this.activeSessions.set(sessionKey, abortController);

      void this.dispatch(message, abortController.signal).finally(() => {
        this.activeSessions.delete(sessionKey);
      });
    }
  }

  private async dispatch(message: InboundMessage, signal: AbortSignal): Promise<void> {
    try {
      const response = await this.processMessage(message, signal);
      if (response) {
        await this.bus.publishOutbound(response);
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      await this.bus.publishOutbound({
        channel: message.channel,
        chatId: message.chatId,
        content: `抱歉，遇到错误：${msg}`,
      });
    }
  }

  private async handleStop(message: InboundMessage): Promise<void> {
    const sessionKey = getSessionKey(message);
    const controller = this.activeSessions.get(sessionKey);
    if (controller) {
      controller.abort();
      this.activeSessions.delete(sessionKey);
      await this.bus.publishOutbound({
        channel: message.channel,
        chatId: message.chatId,
        content: "已停止任务。",
      });
    } else {
      await this.bus.publishOutbound({
        channel: message.channel,
        chatId: message.chatId,
        content: "没有活动任务需要停止。",
      });
    }
  }

  private async processMessage(
    message: InboundMessage,
    signal: AbortSignal,
  ): Promise<OutboundMessage | null> {
    const command = message.content.trim().toLowerCase();

    if (command === "/help") {
      return {
        channel: message.channel,
        chatId: message.chatId,
        content: "命令：\n/new - 开始新对话\n/stop - 停止当前任务\n/help - 显示命令",
      };
    }

    if (command === "/new") {
      const sessionKey = getSessionKey(message);
      this.sessionIds.delete(sessionKey);
      return {
        channel: message.channel,
        chatId: message.chatId,
        content: "新会话已开始。",
      };
    }

    const sessionKey = getSessionKey(message);
    const options = this.buildQueryOptions(sessionKey, command !== "/new");

    let finalContent = "";
    const progressHandler = async (content: string) => {
      if (this.channelsConfig?.sendProgress) {
        await this.bus.publishOutbound({
          channel: message.channel,
          chatId: message.chatId,
          content,
          metadata: {
            ...(message.metadata ?? {}),
            _progress: true,
          },
        });
      }
    };

    try {
      for await (const msg of query({
        prompt: message.content,
        options,
      })) {
        if (signal.aborted) {
          throw new Error("请求已中止");
        }

        // 捕获会话 ID
        if ("session_id" in msg && typeof msg.session_id === "string") {
          this.sessionIds.set(sessionKey, msg.session_id);
        }

        if ("result" in msg && msg.result) {
          finalContent = msg.result;
        } else if ("content" in msg && msg.content) {
          await progressHandler(msg.content);
        }
      }
    } catch (error) {
      if (signal.aborted) {
        return null;
      }
      throw error;
    }

    return {
      channel: message.channel,
      chatId: message.chatId,
      content: finalContent || "处理完成。",
      metadata: message.metadata ?? {},
    };
  }

  private buildQueryOptions(sessionKey: string, continueSession: boolean): Options {
    const options: Options = {
      cwd: this.workspace,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"],
      maxTurns: this.maxIterations,
      settingSources: ["user", "project"],
      debug: true,
      stderr: (data: string) => {
        console.error(`[SDK stderr] ${data}`);
      },
    };

    // 会话管理：继续现有会话或开始新会话
    if (continueSession && this.sessionIds.has(sessionKey)) {
      options.resume = this.sessionIds.get(sessionKey);
    }

    // 配置 hooks
    options.hooks = {
      SessionStart: [
        {
          hooks: [
            async () => {
              console.log(`[Hook] 会话开始: ${sessionKey}`);
              return {};
            },
          ],
        },
      ],
    };

    // 定义内置子代理
    options.agents = {
      "code-reviewer": {
        description: "代码审查专家，用于质量和安全审查",
        prompt: "你是一个代码审查专家。分析代码质量、安全性和最佳实践，提供改进建议。",
        tools: ["Read", "Glob", "Grep"],
      },
      "test-runner": {
        description: "测试运行器，用于运行测试并报告结果",
        prompt: "你是一个测试运行器。运行测试并报告结果，包括失败的测试和错误信息。",
        tools: ["Read", "Bash", "Glob"],
      },
    };

    if (this.mcpConfig && Object.keys(this.mcpConfig.servers).length > 0) {
      options.mcpServers = {};
      for (const [name, config] of Object.entries(this.mcpConfig.servers)) {
        if (!config.disabled) {
          options.mcpServers[name] = {
            command: config.command,
            args: config.args,
            env: config.env,
          };
        }
      }
    }

    return options;
  }
}
