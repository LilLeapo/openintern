import type { LLMProvider } from "../../llm/provider.js";
import type { Session, SessionMessage } from "../session/session-store.js";
import { MemoryStore } from "./store.js";

const SAVE_MEMORY_TOOL = [
  {
    type: "function",
    function: {
      name: "save_memory",
      description: "Save the memory consolidation result to persistent storage.",
      parameters: {
        type: "object",
        properties: {
          history_entry: {
            type: "string",
            description:
              "A paragraph (2-5 sentences) summarizing key events/decisions/topics. Start with [YYYY-MM-DD HH:MM].",
          },
          memory_update: {
            type: "string",
            description:
              "Full updated long-term memory as markdown. Include all existing facts plus new ones.",
          },
        },
        required: ["history_entry", "memory_update"],
      },
    },
  },
] as const;

function formatMessageLine(message: SessionMessage): string | null {
  const content = message.content;
  if (!content) {
    return null;
  }
  const text = typeof content === "string" ? content : JSON.stringify(content);
  if (!text.trim()) {
    return null;
  }
  const timestamp =
    typeof message.timestamp === "string" ? message.timestamp.slice(0, 16) : "?";
  return `[${timestamp}] ${message.role.toUpperCase()}: ${text}`;
}

export class MemoryConsolidator {
  constructor(private readonly memory: MemoryStore) {}

  async consolidate(options: {
    session: Session;
    provider: LLMProvider;
    model: string;
    archiveAll?: boolean;
    memoryWindow?: number;
  }): Promise<boolean> {
    const archiveAll = options.archiveAll ?? false;
    const memoryWindow = options.memoryWindow ?? 50;
    const keepCount = archiveAll ? 0 : Math.floor(memoryWindow / 2);

    if (!archiveAll) {
      if (options.session.messages.length <= keepCount) {
        return true;
      }
      if (options.session.messages.length - options.session.lastConsolidated <= 0) {
        return true;
      }
    }

    const toProcess = archiveAll
      ? options.session.messages
      : options.session.messages.slice(options.session.lastConsolidated, -keepCount || undefined);
    if (toProcess.length === 0) {
      return true;
    }

    const lines = toProcess
      .map((message) => formatMessageLine(message))
      .filter((line): line is string => Boolean(line));
    if (lines.length === 0) {
      options.session.lastConsolidated = archiveAll
        ? 0
        : options.session.messages.length - keepCount;
      return true;
    }

    const currentMemory = await this.memory.readLongTerm();
    const prompt = [
      "Process this conversation and call the save_memory tool with your consolidation.",
      "",
      "## Current Long-term Memory",
      currentMemory || "(empty)",
      "",
      "## Conversation to Process",
      lines.join("\n"),
    ].join("\n");

    try {
      const response = await options.provider.chat({
        messages: [
          {
            role: "system",
            content:
              "You are a memory consolidation agent. Call the save_memory tool with your consolidation of the conversation.",
          },
          { role: "user", content: prompt },
        ],
        tools: SAVE_MEMORY_TOOL as unknown as Array<Record<string, unknown>>,
        model: options.model,
      });

      const saveCall = response.toolCalls.find((call) => call.name === "save_memory");
      if (!saveCall) {
        return false;
      }

      const historyEntry =
        typeof saveCall.arguments.history_entry === "string"
          ? saveCall.arguments.history_entry
          : JSON.stringify(saveCall.arguments.history_entry ?? "");
      const memoryUpdate =
        typeof saveCall.arguments.memory_update === "string"
          ? saveCall.arguments.memory_update
          : JSON.stringify(saveCall.arguments.memory_update ?? "");

      if (historyEntry.trim()) {
        await this.memory.appendHistory(historyEntry);
      }
      if (memoryUpdate !== currentMemory) {
        await this.memory.writeLongTerm(memoryUpdate);
      }

      options.session.lastConsolidated = archiveAll
        ? 0
        : options.session.messages.length - keepCount;
      return true;
    } catch {
      return false;
    }
  }
}

