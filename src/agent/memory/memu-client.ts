interface MemUClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
}

export interface MemUConversationMessage {
  role: string;
  content: string;
  timestamp?: string;
}

export interface MemURetrieveResult {
  categories: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
  resources: Array<Record<string, unknown>>;
  nextStepQuery: string | null;
  raw: Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asObject(item))
    .filter((item) => Object.keys(item).length > 0);
}

function firstString(
  input: Record<string, unknown>,
  keys: string[],
  fallback: string | null = null,
): string | null {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

function compactJson(value: unknown, maxChars = 180): string {
  const text = JSON.stringify(value);
  if (!text) {
    return "";
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

export class MemUClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: MemUClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = Math.max(options.timeoutMs ?? 15_000, 1_000);
  }

  async memorizeConversation(options: {
    conversation: MemUConversationMessage[];
    userId: string;
    agentId: string;
    overrideConfig?: Record<string, unknown>;
  }): Promise<{ taskId: string | null; raw: Record<string, unknown> }> {
    const payload: Record<string, unknown> = {
      conversation: options.conversation.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      })),
      user_id: options.userId,
      agent_id: options.agentId,
    };
    if (options.overrideConfig && Object.keys(options.overrideConfig).length > 0) {
      payload.override_config = options.overrideConfig;
    }

    const raw = await this.requestJson("POST", "/api/v3/memory/memorize", payload);
    const taskId = typeof raw.task_id === "string" ? raw.task_id : null;
    return { taskId, raw };
  }

  async retrieve(options: {
    query: string;
    userId: string;
    agentId: string;
  }): Promise<MemURetrieveResult> {
    const raw = await this.requestJson("POST", "/api/v3/memory/retrieve", {
      query: options.query,
      user_id: options.userId,
      agent_id: options.agentId,
    });

    return {
      categories: asRecordArray(raw.categories),
      items: asRecordArray(raw.items),
      resources: asRecordArray(raw.resources),
      nextStepQuery: typeof raw.next_step_query === "string" ? raw.next_step_query : null,
      raw,
    };
  }

  async listCategories(options: {
    userId: string;
    agentId: string;
  }): Promise<Array<Record<string, unknown>>> {
    const raw = await this.requestJson("POST", "/api/v3/memory/categories", {
      user_id: options.userId,
      agent_id: options.agentId,
    });
    return asRecordArray(raw.categories);
  }

  async getMemorizeStatus(taskId: string): Promise<Record<string, unknown>> {
    return this.requestJson("GET", `/api/v3/memory/memorize/status/${encodeURIComponent(taskId)}`);
  }

  static formatRetrieveContext(
    result: MemURetrieveResult,
    limits?: { categories?: number; items?: number; resources?: number },
  ): string | null {
    const maxCategories = Math.max(limits?.categories ?? 4, 0);
    const maxItems = Math.max(limits?.items ?? 8, 0);
    const maxResources = Math.max(limits?.resources ?? 3, 0);

    const categoryLines: string[] = [];
    for (const category of result.categories.slice(0, maxCategories)) {
      const name = firstString(category, ["name", "title"], "category");
      const summary = firstString(category, ["summary", "description"], compactJson(category));
      categoryLines.push(`- ${name}: ${summary}`);
    }

    const itemLines: string[] = [];
    for (const item of result.items.slice(0, maxItems)) {
      const summary = firstString(
        item,
        ["summary", "memory_content", "content", "text", "title"],
        compactJson(item),
      );
      itemLines.push(`- ${summary}`);
    }

    const resourceLines: string[] = [];
    for (const resource of result.resources.slice(0, maxResources)) {
      const url = firstString(resource, ["resource_url", "url", "path"], compactJson(resource));
      resourceLines.push(`- ${url}`);
    }

    const sections: string[] = [];
    if (categoryLines.length > 0) {
      sections.push(`## Related Categories\n${categoryLines.join("\n")}`);
    }
    if (itemLines.length > 0) {
      sections.push(`## Relevant Memory Items\n${itemLines.join("\n")}`);
    }
    if (resourceLines.length > 0) {
      sections.push(`## Source Resources\n${resourceLines.join("\n")}`);
    }
    if (result.nextStepQuery) {
      sections.push(`## Predicted Next-Step Query\n${result.nextStepQuery}`);
    }

    if (sections.length === 0) {
      return null;
    }
    return sections.join("\n\n");
  }

  private async requestJson(
    method: "GET" | "POST",
    endpoint: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        const detail = text.trim() ? `: ${text.slice(0, 300)}` : "";
        throw new Error(
          `MemU API ${method} ${endpoint} failed (${response.status} ${response.statusText})${detail}`,
        );
      }

      const data = (await response.json()) as unknown;
      return asObject(data);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`MemU API ${method} ${endpoint} timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
