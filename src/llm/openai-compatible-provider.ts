import type { ChatRequest, LLMProvider, LLMResponse, ToolCallRequest } from "./provider.js";
import {
  isRetryableFetchError,
  llmMaxAttempts,
  shouldRetryHttpStatus,
  waitBeforeRetry,
} from "./retry.js";

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  apiBase: string;
  defaultModel: string;
  extraHeaders?: Record<string, string>;
}

function parseToolCalls(rawToolCalls: unknown): ToolCallRequest[] {
  if (!Array.isArray(rawToolCalls)) {
    return [];
  }

  const out: ToolCallRequest[] = [];
  for (const item of rawToolCalls) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const functionBlock =
      typeof record.function === "object" && record.function !== null
        ? (record.function as Record<string, unknown>)
        : {};
    const name = typeof functionBlock.name === "string" ? functionBlock.name : "";
    if (!name) {
      continue;
    }

    let args: Record<string, unknown> = {};
    const rawArgs = functionBlock.arguments;
    if (typeof rawArgs === "string") {
      try {
        const parsed = JSON.parse(rawArgs) as unknown;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = {};
      }
    } else if (typeof rawArgs === "object" && rawArgs !== null && !Array.isArray(rawArgs)) {
      args = rawArgs as Record<string, unknown>;
    }

    out.push({
      id: typeof record.id === "string" ? record.id : `${name}_${out.length + 1}`,
      name,
      arguments: args,
    });
  }
  return out;
}

function sanitizeMessages(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const allowedKeys = new Set([
    "role",
    "content",
    "tool_calls",
    "tool_call_id",
    "name",
    "reasoning_content",
    "thinking_blocks",
  ]);

  return messages.map((message) => {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(message)) {
      if (allowedKeys.has(key)) {
        clean[key] = value;
      }
    }
    if (
      clean.role === "assistant" &&
      clean.tool_calls !== undefined &&
      (clean.content === undefined || clean.content === "")
    ) {
      clean.content = null;
    }
    return clean;
  });
}

export class OpenAICompatibleProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly defaultModel: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.apiKey = options.apiKey;
    this.apiBase = options.apiBase.replace(/\/+$/, "");
    this.defaultModel = options.defaultModel;
    this.extraHeaders = options.extraHeaders ?? {};
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    const model = request.model ?? this.defaultModel;
    const maxAttempts = llmMaxAttempts();

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(`${this.apiBase}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
            ...this.extraHeaders,
          },
          body: JSON.stringify({
            model,
            messages: sanitizeMessages(request.messages),
            tools: request.tools && request.tools.length > 0 ? request.tools : undefined,
            tool_choice: request.tools && request.tools.length > 0 ? "auto" : undefined,
            max_tokens: Math.max(1, request.maxTokens ?? 4096),
            temperature: request.temperature ?? 0.7,
            reasoning_effort: request.reasoningEffort ?? undefined,
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
        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const firstChoice =
          choices.length > 0 && typeof choices[0] === "object" && choices[0] !== null
            ? (choices[0] as Record<string, unknown>)
            : {};
        const message =
          typeof firstChoice.message === "object" && firstChoice.message !== null
            ? (firstChoice.message as Record<string, unknown>)
            : {};

        return {
          content: typeof message.content === "string" ? message.content : null,
          toolCalls: parseToolCalls(message.tool_calls),
          finishReason:
            typeof firstChoice.finish_reason === "string" ? firstChoice.finish_reason : "stop",
          usage:
            typeof payload.usage === "object" && payload.usage !== null
              ? (payload.usage as Record<string, number>)
              : {},
          reasoningContent:
            typeof message.reasoning_content === "string" ? message.reasoning_content : null,
          thinkingBlocks: Array.isArray(message.thinking_blocks)
            ? (message.thinking_blocks as Array<Record<string, unknown>>)
            : undefined,
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
