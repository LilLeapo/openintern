import type { ChatRequest, LLMProvider, LLMResponse, ToolCallRequest } from "./provider.js";
import {
  isRetryableFetchError,
  llmMaxAttempts,
  shouldRetryHttpStatus,
  waitBeforeRetry,
} from "./retry.js";

export interface AnthropicCompatibleProviderOptions {
  apiKey: string;
  apiBase: string;
  defaultModel: string;
  anthropicVersion?: string;
  extraHeaders?: Record<string, string>;
}

type ContentBlock = Record<string, unknown>;

function parseDataImageUrl(url: string): { mediaType: string; data: string } | null {
  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return null;
  }
  return {
    mediaType: match[1],
    data: match[2],
  };
}

function toText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseOpenAIContentToBlocks(content: unknown, role: "user" | "assistant"): ContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  if (!Array.isArray(content)) {
    return [{ type: "text", text: toText(content) }];
  }

  const blocks: ContentBlock[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const block = item as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text });
      continue;
    }
    if (role === "user" && block.type === "image_url") {
      const imageUrl =
        typeof block.image_url === "object" && block.image_url !== null
          ? (block.image_url as Record<string, unknown>).url
          : null;
      if (typeof imageUrl === "string") {
        const parsed = parseDataImageUrl(imageUrl);
        if (parsed) {
          blocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: parsed.mediaType,
              data: parsed.data,
            },
          });
        }
      }
    }
  }

  if (blocks.length === 0) {
    blocks.push({ type: "text", text: toText(content) });
  }
  return blocks;
}

function convertMessages(messages: Array<Record<string, unknown>>): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: ContentBlock[] }>;
} {
  const systemParts: string[] = [];
  const converted: Array<{ role: "user" | "assistant"; content: ContentBlock[] }> = [];

  const pendingToolResults: ContentBlock[] = [];
  const flushPendingToolResults = () => {
    if (pendingToolResults.length === 0) {
      return;
    }
    converted.push({
      role: "user",
      content: [...pendingToolResults],
    });
    pendingToolResults.length = 0;
  };

  for (const message of messages) {
    const role = message.role;
    const content = message.content;

    if (role === "system") {
      if (typeof content === "string") {
        systemParts.push(content);
      } else if (Array.isArray(content)) {
        const text = content
          .map((item) =>
            typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).text === "string"
              ? ((item as Record<string, unknown>).text as string)
              : null,
          )
          .filter((value): value is string => Boolean(value))
          .join("\n");
        if (text) {
          systemParts.push(text);
        }
      }
      continue;
    }

    if (role === "tool") {
      const toolUseId = typeof message.tool_call_id === "string" ? message.tool_call_id : "";
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: toolUseId,
        content: toText(content),
      });
      continue;
    }

    flushPendingToolResults();

    if (role === "user") {
      converted.push({
        role: "user",
        content: parseOpenAIContentToBlocks(content, "user"),
      });
      continue;
    }

    if (role === "assistant") {
      const blocks = parseOpenAIContentToBlocks(content, "assistant");
      const toolCalls = Array.isArray(message.tool_calls)
        ? (message.tool_calls as Array<Record<string, unknown>>)
        : [];

      for (const toolCall of toolCalls) {
        const functionBlock =
          typeof toolCall.function === "object" && toolCall.function !== null
            ? (toolCall.function as Record<string, unknown>)
            : {};
        const name =
          typeof functionBlock.name === "string"
            ? functionBlock.name
            : typeof toolCall.name === "string"
              ? toolCall.name
              : "";
        if (!name) {
          continue;
        }
        const rawArguments = functionBlock.arguments;
        let input: Record<string, unknown> = {};
        if (typeof rawArguments === "string") {
          try {
            const parsed = JSON.parse(rawArguments) as unknown;
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
              input = parsed as Record<string, unknown>;
            }
          } catch {
            input = {};
          }
        } else if (
          typeof rawArguments === "object" &&
          rawArguments !== null &&
          !Array.isArray(rawArguments)
        ) {
          input = rawArguments as Record<string, unknown>;
        }

        blocks.push({
          type: "tool_use",
          id: typeof toolCall.id === "string" ? toolCall.id : `${name}_${blocks.length + 1}`,
          name,
          input,
        });
      }

      converted.push({
        role: "assistant",
        content: blocks,
      });
    }
  }

  flushPendingToolResults();
  return {
    system: systemParts.join("\n\n"),
    messages: converted,
  };
}

function mapTools(tools?: Array<Record<string, unknown>>): Array<Record<string, unknown>> | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  const mapped: Array<Record<string, unknown>> = [];
  for (const tool of tools) {
    const fn =
      typeof tool.function === "object" && tool.function !== null
        ? (tool.function as Record<string, unknown>)
        : null;
    if (!fn || typeof fn.name !== "string") {
      continue;
    }
    mapped.push({
      name: fn.name,
      description: typeof fn.description === "string" ? fn.description : "",
      input_schema:
        typeof fn.parameters === "object" && fn.parameters !== null
          ? fn.parameters
          : { type: "object", properties: {}, required: [] },
    });
  }
  return mapped.length > 0 ? mapped : undefined;
}

function parseToolCalls(content: unknown): ToolCallRequest[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const toolCalls: ToolCallRequest[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const block = item as Record<string, unknown>;
    if (block.type !== "tool_use") {
      continue;
    }
    const name = typeof block.name === "string" ? block.name : "";
    if (!name) {
      continue;
    }
    const input =
      typeof block.input === "object" && block.input !== null && !Array.isArray(block.input)
        ? (block.input as Record<string, unknown>)
        : {};
    toolCalls.push({
      id: typeof block.id === "string" ? block.id : `${name}_${toolCalls.length + 1}`,
      name,
      arguments: input,
    });
  }
  return toolCalls;
}

function parseTextContent(content: unknown): string | null {
  if (!Array.isArray(content)) {
    return null;
  }
  const texts: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const block = item as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    }
  }
  if (texts.length === 0) {
    return null;
  }
  return texts.join("\n").trim() || null;
}

export class AnthropicCompatibleProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly defaultModel: string;
  private readonly anthropicVersion: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: AnthropicCompatibleProviderOptions) {
    this.apiKey = options.apiKey;
    this.apiBase = options.apiBase.replace(/\/+$/, "");
    this.defaultModel = options.defaultModel;
    this.anthropicVersion = options.anthropicVersion ?? "2023-06-01";
    this.extraHeaders = options.extraHeaders ?? {};
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    const model = request.model ?? this.defaultModel;
    const converted = convertMessages(request.messages);
    const maxAttempts = llmMaxAttempts();

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(`${this.apiBase}/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": this.anthropicVersion,
            ...this.extraHeaders,
          },
          body: JSON.stringify({
            model,
            system: converted.system || undefined,
            messages: converted.messages,
            tools: mapTools(request.tools),
            max_tokens: Math.max(1, request.maxTokens ?? 4096),
            temperature: request.temperature ?? 0.7,
          }),
          signal: request.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          if (attempt < maxAttempts && shouldRetryHttpStatus(response.status)) {
            await waitBeforeRetry(attempt, request.signal);
            continue;
          }

          return {
            content: `Error calling LLM: HTTP ${response.status} ${response.statusText}. ${errorText}`,
            toolCalls: [],
            finishReason: "error",
          };
        }

        const payload = (await response.json()) as Record<string, unknown>;
        const content = payload.content;
        return {
          content: parseTextContent(content),
          toolCalls: parseToolCalls(content),
          finishReason: typeof payload.stop_reason === "string" ? payload.stop_reason : "stop",
          usage:
            typeof payload.usage === "object" && payload.usage !== null
              ? (payload.usage as Record<string, number>)
              : {},
        };
      } catch (error) {
        if (attempt < maxAttempts && isRetryableFetchError(error)) {
          try {
            await waitBeforeRetry(attempt, request.signal);
            continue;
          } catch (sleepError) {
            const sleepMessage =
              sleepError instanceof Error ? sleepError.message : String(sleepError);
            return {
              content: `Error calling LLM: ${sleepMessage}`,
              toolCalls: [],
              finishReason: "error",
            };
          }
        }

        const message = error instanceof Error ? error.message : String(error);
        return {
          content: `Error calling LLM: ${message}`,
          toolCalls: [],
          finishReason: "error",
        };
      }
    }

    return {
      content: `Error calling LLM: Request failed after ${maxAttempts} attempts.`,
      toolCalls: [],
      finishReason: "error",
    };
  }
}
