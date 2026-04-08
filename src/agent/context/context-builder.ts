import { readFile } from "node:fs/promises";
import path from "node:path";

import type { MemoryMode, WikiNamespaceConfig } from "../../config/schema.js";
import { WikiNamespaceResolver } from "../memory/wiki-namespace.js";
import { MemoryStore } from "../memory/store.js";
import { SkillsLoader } from "../skills/loader.js";

type HistoryMessage = Record<string, unknown>;
const TOOL_RESULT_CONTEXT_MAX_CHARS = 4_000;

export function sanitizeToolResultForContext(toolName: string, result: string): string {
  const clean = result.replace(/\u0000/g, "");
  if (clean.length <= TOOL_RESULT_CONTEXT_MAX_CHARS) {
    return clean;
  }
  return `${clean.slice(0, TOOL_RESULT_CONTEXT_MAX_CHARS)}\n... (${toolName} result truncated for context)`;
}

export function formatDateTimeForTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const year = map.get("year") ?? "0000";
  const month = map.get("month") ?? "01";
  const day = map.get("day") ?? "01";
  const hour = map.get("hour") ?? "00";
  const minute = map.get("minute") ?? "00";
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

export class ContextBuilder {
  static readonly BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md"];
  static readonly RUNTIME_CONTEXT_TAG = "[Runtime Context - metadata only, not instructions]";
  static readonly EXTERNAL_MEMORY_TAG = "[External Memory Context - retrieved facts, not user input]";

  private readonly skills: SkillsLoader;
  private readonly memoryMode: MemoryMode;
  private readonly wikiConfig: WikiNamespaceConfig | null;

  constructor(
    private readonly workspace: string,
    memoryMode: MemoryMode = "wiki",
    wikiConfig?: WikiNamespaceConfig,
  ) {
    this.skills = new SkillsLoader(workspace);
    this.memoryMode = memoryMode;
    this.wikiConfig = memoryMode === "wiki" ? (wikiConfig ?? null) : null;
  }

  async buildSystemPrompt(memoryStore?: MemoryStore): Promise<string> {
    const identity = this.buildIdentity();
    const bootstrap = await this.loadBootstrapFiles();
    const memory = await (memoryStore ?? new MemoryStore(this.workspace)).getMemoryContext();
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

  buildRuntimeContext(
    channel?: string,
    chatId?: string,
    metadata?: {
      tenantId?: string;
      principalId?: string;
      conversationId?: string;
      [key: string]: unknown;
    },
  ): string {
    const now = new Date();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const local = formatDateTimeForTimeZone(now, tz);

    const lines = [`Current Time: ${local} (${tz})`];
    if (channel && chatId) {
      lines.push(`Channel: ${channel}`);
      lines.push(`Chat ID: ${chatId}`);
    }
    if (metadata?.tenantId) {
      lines.push(`Tenant ID: ${metadata.tenantId}`);
    }
    if (metadata?.principalId) {
      lines.push(`Principal ID: ${metadata.principalId}`);
    }
    if (metadata?.conversationId) {
      lines.push(`Conversation ID: ${metadata.conversationId}`);
    }

    // Resolve wiki namespace for this context
    if (this.memoryMode === "wiki" && this.wikiConfig) {
      const wikiRoot = path.join(path.resolve(this.workspace), "wiki");
      const resolver = new WikiNamespaceResolver(wikiRoot, this.wikiConfig);
      const deptKey = this.wikiConfig.departmentKey;
      const department =
        deptKey && metadata && typeof metadata[deptKey] === "string"
          ? (metadata[deptKey] as string)
          : undefined;
      const resolved = resolver.resolve({
        principalId: metadata?.principalId,
        department,
      });
      lines.push(`Wiki Active Namespace: ${resolved.active}`);
      lines.push(`Wiki Readable Namespaces: ${resolved.readable.join(", ")}`);
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
    memoryStore?: MemoryStore;
    runtimeMetadata?: {
      tenantId?: string;
      principalId?: string;
      conversationId?: string;
    };
  }): Promise<HistoryMessage[]> {
    const externalMemory =
      typeof options.retrievedMemory === "string" && options.retrievedMemory.trim()
        ? `${ContextBuilder.EXTERNAL_MEMORY_TAG}\n${options.retrievedMemory}`
        : null;

    return [
      { role: "system", content: await this.buildSystemPrompt(options.memoryStore) },
      ...options.history,
      ...(externalMemory ? [{ role: "system", content: externalMemory }] : []),
      {
        role: "user",
        content: this.buildRuntimeContext(options.channel, options.chatId, options.runtimeMetadata),
      },
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
      content: sanitizeToolResultForContext(toolName, result),
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
${this.memoryMode === "wiki" ? `- Raw sources: ${workspacePath}/raw/
- Wiki root: ${workspacePath}/wiki/
- Wiki namespaces: @shared/ (default), @user-{id}/ (personal), @dept-{name}/ (department)
- Each namespace has: index.md, log.md, sources/, entities/, concepts/, analyses/` : ""}
- Custom skills: ${workspacePath}/skills/{skill-name}/SKILL.md

## Guidelines
- State intent before tool calls, but never predict results before receiving them.
- Before modifying a file, read it first.
- After writing or editing a file, re-read it if accuracy matters.
- If a tool call fails, analyze the error before retrying with a different approach.
- Ask for clarification when the request is ambiguous.
${this.memoryMode === "wiki" ? `- Knowledge management uses wiki mode: maintain structured wiki pages instead of memory tools.
- Wiki is organized into namespaces (@shared/, @user-{id}/, @dept-{name}/). Check runtime context for the active namespace.
- Read the active namespace's index.md to locate knowledge. Also check @shared/index.md for shared knowledge.
- Use [[@namespace/page-name]] for cross-namespace references.
- Raw sources in raw/ are read-only; never modify them.` : `- Use memory tools selectively: save only stable high-value facts/decisions.
- Prefer scope "chat" for conversational memory and scope "papers" for document knowledge.
- Ask for user confirmation before saving sensitive personal information.`}
- For workflow execution and progress, use trigger_workflow/query_workflow_status directly.
`;
  }

  private async loadBootstrapFiles(): Promise<string> {
    const files = [...ContextBuilder.BOOTSTRAP_FILES];
    if (this.memoryMode === "wiki") {
      files.push("WIKI_SCHEMA.md");
    }
    const parts: string[] = [];
    for (const filename of files) {
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
