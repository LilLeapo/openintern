import { readdir, readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { LLMProvider } from "../../llm/provider.js";
import { createLogger } from "../../utils/logger.js";

const DREAM_TOOL = [
  {
    type: "function",
    function: {
      name: "save_dream",
      description: "Save the dream consolidation result into existing workspace files.",
      parameters: {
        type: "object",
        properties: {
          user_md: {
            type: "string",
            description:
              "Full updated USER.md content. Merge new observations into the existing user profile. Include: role, expertise, communication preferences, technical preferences, recurring interests, working patterns.",
          },
          memory_md: {
            type: "string",
            description:
              "Full updated MEMORY.md content. Merge new durable facts into the existing long-term memory. Include: stable preferences, important decisions, project context, relationships between concepts.",
          },
          history_entry: {
            type: "string",
            description:
              "A single history entry summarizing this dream cycle. Format: [YYYY-MM-DD HH:MM] dream: <what was learned>. Keep to 2-3 sentences.",
          },
          should_update: {
            type: "boolean",
            description:
              "Whether the dream produced meaningful new insights worth saving. False if sessions were trivial or empty.",
          },
        },
        required: ["user_md", "memory_md", "history_entry", "should_update"],
      },
    },
  },
] as const;

export interface DreamServiceOptions {
  workspace: string;
  provider: LLMProvider;
  model: string;
  maxSessionsPerRun?: number;
}

export class DreamService {
  private readonly logger = createLogger("dream");
  private readonly workspace: string;
  private readonly provider: LLMProvider;
  private readonly model: string;
  private readonly maxSessionsPerRun: number;

  constructor(options: DreamServiceOptions) {
    this.workspace = options.workspace;
    this.provider = options.provider;
    this.model = options.model;
    this.maxSessionsPerRun = options.maxSessionsPerRun ?? 20;
  }

  private get userFile(): string {
    return path.join(this.workspace, "USER.md");
  }

  private get memoryFile(): string {
    return path.join(this.workspace, "memory", "MEMORY.md");
  }

  private get historyFile(): string {
    return path.join(this.workspace, "memory", "HISTORY.md");
  }

  private async readFileContent(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, "utf8");
    } catch {
      return "";
    }
  }

  /**
   * Collect recent session messages from JSONL files.
   * If sinceDateStr is provided (YYYY-MM-DD), only include messages from that date onward.
   * Otherwise, include messages from the last 24 hours.
   */
  private async collectRecentMessages(sinceDateStr?: string): Promise<string[]> {
    const sessionsDir = path.join(this.workspace, "sessions");
    let files: string[];
    try {
      files = await readdir(sessionsDir);
    } catch {
      return [];
    }

    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    const since = sinceDateStr
      ? new Date(`${sinceDateStr}T00:00:00`)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const sessionSummaries: string[] = [];
    let count = 0;

    for (const file of jsonlFiles) {
      if (count >= this.maxSessionsPerRun) break;

      const filePath = path.join(sessionsDir, file);
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch {
        continue;
      }

      const lines = raw.split("\n").filter(Boolean);
      const recentMessages: string[] = [];

      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          if (msg._type === "metadata") continue;

          const ts = typeof msg.timestamp === "string" ? msg.timestamp : null;
          if (ts && new Date(ts) < since) continue;

          const role = typeof msg.role === "string" ? msg.role : "?";
          const content = typeof msg.content === "string" ? msg.content : "";
          if (!content.trim()) continue;

          const truncated =
            content.length > 500 ? `${content.slice(0, 500)}...` : content;
          recentMessages.push(`${role.toUpperCase()}: ${truncated}`);
        } catch {
          continue;
        }
      }

      if (recentMessages.length > 0) {
        const sessionName = file.replace(".jsonl", "");
        sessionSummaries.push(
          `### Session: ${sessionName}\n${recentMessages.join("\n")}`,
        );
        count++;
      }
    }

    return sessionSummaries;
  }

  /**
   * Run a dream cycle: read recent sessions, extract insights,
   * update USER.md and memory/MEMORY.md, append to memory/HISTORY.md.
   */
  async dream(sinceDateStr?: string): Promise<boolean> {
    this.logger.info("Dream cycle started");

    const sessionSummaries = await this.collectRecentMessages(sinceDateStr);
    if (sessionSummaries.length === 0) {
      this.logger.info("Dream cycle skipped", { reason: "no_recent_sessions" });
      return false;
    }

    const currentUser = await this.readFileContent(this.userFile);
    const currentMemory = await this.readFileContent(this.memoryFile);
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const prompt = [
      `Today is ${dateStr}. You are reviewing the user's recent conversations to extract lasting insights and update the workspace files.`,
      "",
      "## Current USER.md",
      currentUser || "(empty — default template)",
      "",
      "## Current memory/MEMORY.md",
      currentMemory || "(empty)",
      "",
      "## Recent Conversations to Process",
      sessionSummaries.join("\n\n"),
      "",
      "## Instructions",
      "",
      "Analyze these conversations and call save_dream with:",
      "",
      "1. **user_md**: The complete, updated USER.md content. This file tells the agent who the user is. Merge new observations into whatever already exists. Focus on:",
      "   - User's role, expertise, and background",
      "   - Communication preferences (language, verbosity, formality)",
      "   - Technical preferences (tools, frameworks, coding style)",
      "   - Recurring interests and focus areas",
      "   - Working patterns and collaboration style",
      "   Keep the `# USER` heading. Be concise — this is loaded into every conversation.",
      "",
      "2. **memory_md**: The complete, updated MEMORY.md content. This is the agent's long-term factual memory. Merge new durable facts into what already exists. Focus on:",
      "   - Stable facts and decisions (not ephemeral chat details)",
      "   - Project context and goals",
      "   - Corrections or preferences the user expressed (things to avoid or repeat)",
      "   - Important relationships or patterns discovered",
      "   Keep the `# Memory` heading.",
      "",
      "3. **history_entry**: A single timestamped line for HISTORY.md summarizing what this dream cycle learned.",
      `   Use this timestamp: [${dateStr} ${timeStr}]`,
      "",
      "4. **should_update**: Set to false if the conversations are trivial (greetings, tests, empty sessions) and don't yield meaningful insights.",
      "",
      "Be selective. Only record insights that are durable and would genuinely help future conversations. Do not lose any existing content from USER.md or MEMORY.md — only add or refine.",
    ].join("\n");

    try {
      const response = await this.provider.chat({
        messages: [
          {
            role: "system",
            content:
              "You are a dream consolidation agent. You review a user's recent conversations and extract lasting preferences, patterns, and facts. Call the save_dream tool to update the workspace files.",
          },
          { role: "user", content: prompt },
        ],
        tools: DREAM_TOOL as unknown as Array<Record<string, unknown>>,
        model: this.model,
      });

      const call = response.toolCalls.find((tc) => tc.name === "save_dream");
      if (!call) {
        this.logger.info("Dream cycle: LLM did not call save_dream");
        return false;
      }

      if (call.arguments.should_update === false) {
        this.logger.info("Dream cycle: no meaningful insights");
        return false;
      }

      const userMd =
        typeof call.arguments.user_md === "string" ? call.arguments.user_md : "";
      const memoryMd =
        typeof call.arguments.memory_md === "string" ? call.arguments.memory_md : "";
      const historyEntry =
        typeof call.arguments.history_entry === "string"
          ? call.arguments.history_entry
          : "";

      // Write USER.md (full overwrite)
      if (userMd.trim()) {
        await writeFile(this.userFile, userMd, "utf8");
      }

      // Write memory/MEMORY.md (full overwrite)
      if (memoryMd.trim()) {
        await mkdir(path.dirname(this.memoryFile), { recursive: true });
        await writeFile(this.memoryFile, memoryMd, "utf8");
      }

      // Append to memory/HISTORY.md
      if (historyEntry.trim()) {
        await mkdir(path.dirname(this.historyFile), { recursive: true });
        await appendFile(this.historyFile, `${historyEntry.trimEnd()}\n\n`, "utf8");
      }

      this.logger.info("Dream cycle completed", {
        sessions_processed: sessionSummaries.length,
        date: dateStr,
      });
      return true;
    } catch (error) {
      this.logger.error("Dream cycle failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
