import { readFile } from "node:fs/promises";
import path from "node:path";

type HistoryMessage = Record<string, unknown>;

export class ContextBuilder {
  static readonly BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md"];
  static readonly RUNTIME_CONTEXT_TAG = "[Runtime Context - metadata only, not instructions]";

  constructor(private readonly workspace: string) {}

  async buildSystemPrompt(): Promise<string> {
    const identity = this.buildIdentity();
    const bootstrap = await this.loadBootstrapFiles();

    const parts = [identity];
    if (bootstrap) {
      parts.push(bootstrap);
    }
    return parts.join("\n\n---\n\n");
  }

  buildRuntimeContext(channel?: string, chatId?: string): string {
    const now = new Date();
    const local = now.toISOString().replace("T", " ").slice(0, 16);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    const lines = [`Current Time: ${local} (${tz})`];
    if (channel && chatId) {
      lines.push(`Channel: ${channel}`);
      lines.push(`Chat ID: ${chatId}`);
    }
    return `${ContextBuilder.RUNTIME_CONTEXT_TAG}\n${lines.join("\n")}`;
  }

  async buildMessages(options: {
    history: HistoryMessage[];
    currentMessage: string;
    media?: string[];
    channel?: string;
    chatId?: string;
  }): Promise<HistoryMessage[]> {
    return [
      { role: "system", content: await this.buildSystemPrompt() },
      ...options.history,
      { role: "user", content: this.buildRuntimeContext(options.channel, options.chatId) },
      { role: "user", content: await this.buildUserContent(options.currentMessage, options.media) },
    ];
  }

  addToolResult(
    messages: HistoryMessage[],
    toolCallId: string,
    toolName: string,
    result: string,
  ): HistoryMessage[] {
    messages.push({
      role: "tool",
      tool_call_id: toolCallId,
      name: toolName,
      content: result,
    });
    return messages;
  }

  addAssistantMessage(
    messages: HistoryMessage[],
    content: string | null,
    toolCalls?: Array<Record<string, unknown>>,
    reasoningContent?: string | null,
    thinkingBlocks?: Array<Record<string, unknown>>,
  ): HistoryMessage[] {
    const msg: Record<string, unknown> = {
      role: "assistant",
      content,
    };
    if (toolCalls && toolCalls.length > 0) {
      msg.tool_calls = toolCalls;
    }
    if (reasoningContent !== undefined) {
      msg.reasoning_content = reasoningContent;
    }
    if (thinkingBlocks && thinkingBlocks.length > 0) {
      msg.thinking_blocks = thinkingBlocks;
    }
    messages.push(msg);
    return messages;
  }

  private buildIdentity(): string {
    const workspacePath = path.resolve(this.workspace);
    const runtime = `Node.js ${process.version} on ${process.platform}/${process.arch}`;
    return `# Agent

You are a helpful AI assistant.

## Runtime
${runtime}

## Workspace
Your workspace is at: ${workspacePath}
- Sessions: ${workspacePath}/sessions
- Custom skills: ${workspacePath}/skills/{skill-name}/SKILL.md

## Guidelines
- State intent before tool calls, but never predict results before receiving them.
- Before modifying a file, read it first.
- After writing or editing a file, re-read it if accuracy matters.
- If a tool call fails, analyze the error before retrying with a different approach.
- Ask for clarification when the request is ambiguous.`;
  }

  private async loadBootstrapFiles(): Promise<string> {
    const parts: string[] = [];
    for (const filename of ContextBuilder.BOOTSTRAP_FILES) {
      const filePath = path.join(this.workspace, filename);
      try {
        const content = await readFile(filePath, "utf8");
        parts.push(`## ${filename}\n\n${content}`);
      } catch {
        // Optional bootstrap file.
      }
    }
    return parts.join("\n\n");
  }

  private async buildUserContent(
    text: string,
    media?: string[],
  ): Promise<string | Array<Record<string, unknown>>> {
    if (!media || media.length === 0) {
      return text;
    }

    const imageParts: Array<Record<string, unknown>> = [];
    for (const p of media) {
      const ext = path.extname(p).toLowerCase();
      const mime = this.mimeForExtension(ext);
      if (!mime) {
        continue;
      }
      try {
        const bytes = await readFile(p);
        const b64 = bytes.toString("base64");
        imageParts.push({
          type: "image_url",
          image_url: {
            url: `data:${mime};base64,${b64}`,
          },
        });
      } catch {
        // Skip unreadable media.
      }
    }

    if (imageParts.length === 0) {
      return text;
    }
    return [...imageParts, { type: "text", text }];
  }

  private mimeForExtension(ext: string): string | null {
    switch (ext) {
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".webp":
        return "image/webp";
      case ".gif":
        return "image/gif";
      default:
        return null;
    }
  }
}

