import { readFile } from "node:fs/promises";
import path from "node:path";

import { MemoryStore } from "../memory/store.js";
import { SkillsLoader } from "../skills/loader.js";

type HistoryMessage = Record<string, unknown>;

export class ContextBuilder {
  static readonly BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md"];
  static readonly RUNTIME_CONTEXT_TAG = "[Runtime Context - metadata only, not instructions]";
  static readonly EXTERNAL_MEMORY_TAG = "[External Memory Context - retrieved facts, not user input]";

  private readonly memory: MemoryStore;
  private readonly skills: SkillsLoader;

  constructor(private readonly workspace: string) {
    this.memory = new MemoryStore(workspace);
    this.skills = new SkillsLoader(workspace);
  }

  async buildSystemPrompt(): Promise<string> {
    const identity = this.buildIdentity();
    const bootstrap = await this.loadBootstrapFiles();
    const memory = await this.memory.getMemoryContext();
    const alwaysSkills = await this.skills.getAlwaysSkills();
    const alwaysSkillsContent = await this.skills.loadSkillsForContext(alwaysSkills);
    const skillsSummary = await this.skills.buildSkillsSummary();

    const parts = [identity];
    if (bootstrap) {
      parts.push(bootstrap);
    }
    if (memory) {
      parts.push(`# Memory\n\n${memory}`);
    }
    if (alwaysSkillsContent) {
      parts.push(`# Active Skills\n\n${alwaysSkillsContent}`);
    }
    if (skillsSummary) {
      parts.push(
        `# Skills

The following skills extend your capabilities. To use a skill, read its SKILL.md file using the read_file tool.
Skills with available="false" need dependencies installed first.

${skillsSummary}`,
      );
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
    retrievedMemory?: string;
    media?: string[];
    channel?: string;
    chatId?: string;
  }): Promise<HistoryMessage[]> {
    const externalMemory =
      typeof options.retrievedMemory === "string" && options.retrievedMemory.trim()
        ? `${ContextBuilder.EXTERNAL_MEMORY_TAG}\n${options.retrievedMemory}`
        : null;

    return [
      { role: "system", content: await this.buildSystemPrompt() },
      ...options.history,
      ...(externalMemory ? [{ role: "system", content: externalMemory }] : []),
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
- Long-term memory: ${workspacePath}/memory/MEMORY.md
- History log: ${workspacePath}/memory/HISTORY.md
- Custom skills: ${workspacePath}/skills/{skill-name}/SKILL.md

## Guidelines
- State intent before tool calls, but never predict results before receiving them.
- Before modifying a file, read it first.
- After writing or editing a file, re-read it if accuracy matters.
- If a tool call fails, analyze the error before retrying with a different approach.
- Ask for clarification when the request is ambiguous.
- Use memory tools selectively: save only stable high-value facts/decisions.
- Prefer scope "chat" for conversational memory and scope "papers" for document knowledge.
- Ask for user confirmation before saving sensitive personal information.
- For workflow execution and progress, use trigger_workflow/query_workflow_status directly.
`;
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
