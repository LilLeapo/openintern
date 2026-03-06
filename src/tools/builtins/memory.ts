import { MemUClient } from "../../agent/memory/memu-client.js";
import { Tool } from "../core/tool.js";

type MemoryScope = "chat" | "papers";
type MemoryRetrieveScope = MemoryScope | "all";

export interface MemoryScopeResolverInput {
  channel: string;
  chatId: string;
  scope: MemoryScope;
}

export type MemoryScopeResolver = (
  input: MemoryScopeResolverInput,
) => { userId: string; agentId: string };

interface RetrieveLimits {
  categories?: number;
  items?: number;
  resources?: number;
}

function asScope(value: unknown): MemoryScope {
  if (value === "papers") {
    return "papers";
  }
  return "chat";
}

function asRetrieveScope(value: unknown): MemoryRetrieveScope {
  if (value === "all") {
    return "all";
  }
  return asScope(value);
}

function asPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return undefined;
  }
  return Math.floor(num);
}

abstract class MemoryToolBase extends Tool {
  private channel = "cli";
  private chatId = "direct";

  constructor(
    protected readonly memu: MemUClient,
    private readonly resolveScope: MemoryScopeResolver,
  ) {
    super();
  }

  setContext(channel: string, chatId: string): void {
    this.channel = channel;
    this.chatId = chatId;
  }

  protected scope(scope: MemoryScope): { userId: string; agentId: string } {
    return this.resolveScope({
      channel: this.channel,
      chatId: this.chatId,
      scope,
    });
  }
}

export class MemorySaveTool extends MemoryToolBase {
  readonly name = "memory_save";
  readonly description =
    "Persist high-value memory into MemU. Use scope='chat' for conversational memory and scope='papers' for document knowledge.";
  readonly parameters = {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "Memory content to persist.",
      },
      scope: {
        type: "string",
        enum: ["chat", "papers"],
        description: "Logical memory scope.",
      },
    },
    required: ["content"],
  } as const;

  async execute(params: Record<string, unknown>): Promise<string> {
    const content = String(params.content ?? "").trim();
    if (!content) {
      return "Error: content is required";
    }
    const scope = asScope(params.scope);
    const now = new Date().toISOString();
    const result = await this.memu.memorizeConversation({
      conversation: [
        {
          role: "user",
          content,
          timestamp: now,
        },
      ],
      ...this.scope(scope),
    });
    const taskText = result.taskId ? ` (task: ${result.taskId})` : "";
    return `Saved memory to ${scope} scope${taskText}.`;
  }
}

export class MemoryRetrieveTool extends MemoryToolBase {
  readonly name = "memory_retrieve";
  readonly description =
    "Retrieve memory context from MemU. Scope can be chat, papers, or all (merge both scopes).";
  readonly parameters = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query for memory retrieval.",
      },
      scope: {
        type: "string",
        enum: ["chat", "papers", "all"],
        description: "Logical scope to search.",
      },
      categories_limit: {
        type: "integer",
        minimum: 1,
        description: "Optional max number of categories to include.",
      },
      items_limit: {
        type: "integer",
        minimum: 1,
        description: "Optional max number of items to include.",
      },
      resources_limit: {
        type: "integer",
        minimum: 1,
        description: "Optional max number of resources to include.",
      },
    },
    required: ["query"],
  } as const;

  private async retrieveSingle(
    scope: MemoryScope,
    query: string,
    limits: RetrieveLimits,
  ): Promise<string | null> {
    const result = await this.memu.retrieve({
      query,
      ...this.scope(scope),
    });
    return MemUClient.formatRetrieveContext(result, limits);
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const query = String(params.query ?? "").trim();
    if (!query) {
      return "Error: query is required";
    }
    const scope = asRetrieveScope(params.scope);
    const limits: RetrieveLimits = {
      categories: asPositiveInt(params.categories_limit),
      items: asPositiveInt(params.items_limit),
      resources: asPositiveInt(params.resources_limit),
    };

    if (scope === "all") {
      const [chat, papers] = await Promise.all([
        this.retrieveSingle("chat", query, limits),
        this.retrieveSingle("papers", query, limits),
      ]);
      const sections: string[] = [];
      if (chat) {
        sections.push(`# Scope: chat\n${chat}`);
      }
      if (papers) {
        sections.push(`# Scope: papers\n${papers}`);
      }
      if (sections.length === 0) {
        return "No memory found in chat/papers scopes.";
      }
      return sections.join("\n\n");
    }

    const context = await this.retrieveSingle(scope, query, limits);
    if (!context) {
      return `No memory found in ${scope} scope.`;
    }
    return context;
  }
}

export class MemoryDeleteTool extends MemoryToolBase {
  readonly name = "memory_delete";
  readonly description =
    "Delete memories in a logical scope. This requires MemU clear endpoint support.";
  readonly parameters = {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["chat", "papers"],
        description: "Logical scope to clear.",
      },
    },
    required: ["scope"],
  } as const;

  async execute(params: Record<string, unknown>): Promise<string> {
    const scope = asScope(params.scope);
    const result = await this.memu.clearScope(this.scope(scope));
    if (!result.supported) {
      return "Error: memory clear is unsupported for current MemU endpoint configuration";
    }
    return `Cleared memory in ${scope} scope.`;
  }
}

