interface MemUClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  apiStyle?: "cloudV3" | "localSimple" | "mem0V1";
  endpoints?: {
    memorize?: string;
    retrieve?: string;
    categories?: string;
    status?: string;
    clear?: string;
  };
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

type MemUApiStyle = "cloudV3" | "localSimple" | "mem0V1";

interface MemUEndpoints {
  memorize: string;
  retrieve: string;
  categories: string;
  status: string;
  clear: string;
}

const CLOUD_V3_ENDPOINTS: MemUEndpoints = {
  memorize: "/api/v3/memory/memorize",
  retrieve: "/api/v3/memory/retrieve",
  categories: "/api/v3/memory/categories",
  status: "/api/v3/memory/memorize/status/{task_id}",
  clear: "",
};

const LOCAL_SIMPLE_ENDPOINTS: MemUEndpoints = {
  memorize: "/memorize",
  retrieve: "/recall",
  categories: "",
  status: "",
  clear: "",
};

const MEM0_V1_ENDPOINTS: MemUEndpoints = {
  memorize: "/api/v1/memories",
  retrieve: "/api/v1/memories/search",
  categories: "/api/v1/memories",
  status: "",
  clear: "/api/v1/memories",
};

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

function normalizeEndpoint(path: string): string {
  const cleaned = path.trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function resolveEndpoints(
  apiStyle: MemUApiStyle,
  overrides: MemUClientOptions["endpoints"],
): MemUEndpoints {
  const defaults =
    apiStyle === "localSimple"
      ? LOCAL_SIMPLE_ENDPOINTS
      : apiStyle === "mem0V1"
        ? MEM0_V1_ENDPOINTS
        : CLOUD_V3_ENDPOINTS;
  return {
    memorize: normalizeEndpoint(overrides?.memorize ?? defaults.memorize),
    retrieve: normalizeEndpoint(overrides?.retrieve ?? defaults.retrieve),
    categories: normalizeEndpoint(overrides?.categories ?? defaults.categories),
    status: normalizeEndpoint(overrides?.status ?? defaults.status),
    clear: normalizeEndpoint(overrides?.clear ?? defaults.clear),
  };
}

function conversationToText(conversation: MemUConversationMessage[]): string {
  return conversation
    .map((message) => {
      const role = message.role?.trim() || "unknown";
      const content = message.content?.trim() || "";
      const timestamp = message.timestamp ? `${message.timestamp} ` : "";
      return `${timestamp}[${role}] ${content}`.trim();
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

function mem0UnwrapData(raw: Record<string, unknown>): unknown {
  if ("data" in raw) {
    return raw.data;
  }
  return raw;
}

export class MemUClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly apiStyle: MemUApiStyle;
  private readonly endpoints: MemUEndpoints;

  constructor(options: MemUClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = Math.max(options.timeoutMs ?? 15_000, 1_000);
    this.apiStyle = options.apiStyle ?? "cloudV3";
    this.endpoints = resolveEndpoints(this.apiStyle, options.endpoints);
  }

  async memorizeConversation(options: {
    conversation: MemUConversationMessage[];
    userId: string;
    agentId: string;
    overrideConfig?: Record<string, unknown>;
  }): Promise<{ taskId: string | null; raw: Record<string, unknown> }> {
    if (this.apiStyle === "mem0V1") {
      const payload: Record<string, unknown> = {
        messages: options.conversation.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        run_id: options.userId,
        metadata: {
          agent_id: options.agentId,
        },
      };
      const raw = await this.requestJson("POST", this.endpoints.memorize, payload, {
        "X-User-Id": options.userId,
      });
      const data = mem0UnwrapData(raw);
      const dataObj = asObject(data);
      const taskId = typeof dataObj.task_id === "string" ? dataObj.task_id : null;
      return { taskId, raw };
    }

    if (this.apiStyle === "localSimple") {
      const payload: Record<string, unknown> = {
        content: conversationToText(options.conversation),
        user_id: options.userId,
        agent_id: options.agentId,
      };
      const raw = await this.requestJson("POST", this.endpoints.memorize, payload);
      const taskId = typeof raw.task_id === "string" ? raw.task_id : null;
      return { taskId, raw };
    }

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

    const raw = await this.requestJson("POST", this.endpoints.memorize, payload);
    const taskId = typeof raw.task_id === "string" ? raw.task_id : null;
    return { taskId, raw };
  }

  async retrieve(options: {
    query: string;
    userId: string;
    agentId: string;
  }): Promise<MemURetrieveResult> {
    const raw =
      this.apiStyle === "mem0V1"
        ? await this.requestJson(
            "POST",
            this.endpoints.retrieve,
            {
              query: options.query,
              run_id: options.userId,
              filters: {
                agent_id: options.agentId,
              },
            },
            {
              "X-User-Id": options.userId,
            },
          )
        : this.apiStyle === "localSimple"
        ? await this.requestJson(
            "GET",
            this.withQuery(
              this.endpoints.retrieve,
              new URLSearchParams({
                query: options.query,
                user_id: options.userId,
                agent_id: options.agentId,
              }),
            ),
          )
        : await this.requestJson("POST", this.endpoints.retrieve, {
            query: options.query,
            user_id: options.userId,
            agent_id: options.agentId,
          });

    const mem0Data = mem0UnwrapData(raw);
    const mem0List = asRecordArray(mem0Data);
    const mem0Obj = asObject(mem0Data);

    const items = asRecordArray(raw.items);
    const localMemories = asRecordArray(raw.memories);
    const mem0Items = asRecordArray(mem0Obj.items);

    return {
      categories: asRecordArray(raw.categories),
      items:
        items.length > 0
          ? items
          : localMemories.length > 0
            ? localMemories
            : mem0Items.length > 0
              ? mem0Items
              : mem0List,
      resources: asRecordArray(raw.resources),
      nextStepQuery: typeof raw.next_step_query === "string" ? raw.next_step_query : null,
      raw,
    };
  }

  async listCategories(options: {
    userId: string;
    agentId: string;
  }): Promise<Array<Record<string, unknown>>> {
    if (this.apiStyle === "mem0V1") {
      try {
        const raw = await this.requestJson(
          "GET",
          this.withQuery(
            this.endpoints.categories,
            new URLSearchParams({
              run_id: options.userId,
            }),
          ),
          undefined,
          {
            "X-User-Id": options.userId,
          },
        );
        const data = mem0UnwrapData(raw);
        return asRecordArray(data);
      } catch {
        return [];
      }
    }

    if (this.apiStyle === "localSimple") {
      if (!this.endpoints.categories) {
        return [];
      }
      try {
        const raw = await this.requestJson(
          "GET",
          this.withQuery(
            this.endpoints.categories,
            new URLSearchParams({
              user_id: options.userId,
              agent_id: options.agentId,
            }),
          ),
        );
        return asRecordArray(raw.categories);
      } catch {
        return [];
      }
    }

    const raw = await this.requestJson("POST", this.endpoints.categories, {
      user_id: options.userId,
      agent_id: options.agentId,
    });
    return asRecordArray(raw.categories);
  }

  async getMemorizeStatus(taskId: string): Promise<Record<string, unknown>> {
    if (this.apiStyle === "localSimple" && !this.endpoints.status) {
      return { task_id: taskId, status: "completed" };
    }
    return this.requestJson("GET", this.renderStatusPath(taskId));
  }

  async clearScope(options: {
    userId: string;
    agentId: string;
  }): Promise<{ supported: boolean; raw: Record<string, unknown> }> {
    if (this.apiStyle === "mem0V1") {
      const endpoint = this.endpoints.clear || this.endpoints.memorize;
      if (!endpoint) {
        return { supported: false, raw: { error: "clear endpoint not configured" } };
      }
      const raw = await this.requestJson(
        "DELETE",
        this.withQuery(
          endpoint,
          new URLSearchParams({
            run_id: options.userId,
            agent_id: options.agentId,
          }),
        ),
        undefined,
        {
          "X-User-Id": options.userId,
        },
      );
      return { supported: true, raw };
    }

    if (!this.endpoints.clear) {
      return { supported: false, raw: { error: "clear endpoint not configured" } };
    }

    const payload: Record<string, unknown> = {
      user_id: options.userId,
      agent_id: options.agentId,
    };

    try {
      const raw = await this.requestJson("POST", this.endpoints.clear, payload);
      return { supported: true, raw };
    } catch {
      const raw = await this.requestJson(
        "DELETE",
        this.withQuery(
          this.endpoints.clear,
          new URLSearchParams({
            user_id: options.userId,
            agent_id: options.agentId,
          }),
        ),
      );
      return { supported: true, raw };
    }
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
    method: "GET" | "POST" | "DELETE",
    endpoint: string,
    body?: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey.trim()) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    if (extraHeaders) {
      Object.assign(headers, extraHeaders);
    }
    if (method === "POST" || (method === "DELETE" && body)) {
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

      if (response.status === 204) {
        return {};
      }
      if (typeof response.text === "function") {
        const text = await response.text();
        if (!text.trim()) {
          return {};
        }
        try {
          const data = JSON.parse(text) as unknown;
          return asObject(data);
        } catch {
          return { text };
        }
      }

      if (typeof response.json === "function") {
        const data = (await response.json()) as unknown;
        return asObject(data);
      }
      return {};
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`MemU API ${method} ${endpoint} timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private withQuery(endpoint: string, params: URLSearchParams): string {
    const query = params.toString();
    if (!query) {
      return endpoint;
    }
    const joiner = endpoint.includes("?") ? "&" : "?";
    return `${endpoint}${joiner}${query}`;
  }

  private renderStatusPath(taskId: string): string {
    const encoded = encodeURIComponent(taskId);
    const template = this.endpoints.status;
    if (template.includes("{task_id}")) {
      return template.replace("{task_id}", encoded);
    }
    const base = template.replace(/\/+$/, "");
    return `${base}/${encoded}`;
  }
}
