/**
 * Anthropic LLM Client - Uses native fetch to call Anthropic Messages API
 */

import type {
  LLMConfig,
  LLMResponse,
  Message,
  ToolDefinition,
  ToolCall,
} from '../../types/agent.js';
import { getMessageText } from '../../types/agent.js';
import { LLMError } from '../../utils/errors.js';
import type { ILLMClient, LLMCallOptions, LLMStreamChunk } from './llm-client.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicClient implements ILLMClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new LLMError(
        'Anthropic API key is required. Set apiKey in config or ANTHROPIC_API_KEY env var.',
        'anthropic'
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = config.model;
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 2000;
  }

  async chat(messages: Message[], tools?: ToolDefinition[], options?: LLMCallOptions): Promise<LLMResponse> {
    const body = this.buildRequestBody(messages, tools);

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      ...(options?.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new LLMError(
        `Anthropic API error: ${response.status} ${errorBody}`,
        'anthropic',
        response.status
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return this.parseResponse(data);
  }

  private buildRequestBody(
    messages: Message[],
    tools?: ToolDefinition[]
  ): Record<string, unknown> {
    const { systemPrompt, conversationMessages } = this.extractSystemMessages(messages);
    const mappedMessages = this.mapMessages(conversationMessages);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: mappedMessages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => this.mapTool(t));
    }

    return body;
  }

  private extractSystemMessages(messages: Message[]): {
    systemPrompt: string | undefined;
    conversationMessages: Message[];
  } {
    const systemMessages: string[] = [];
    const conversationMessages: Message[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessages.push(getMessageText(msg.content));
      } else {
        conversationMessages.push(msg);
      }
    }

    return {
      systemPrompt: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
      conversationMessages,
    };
  }

  private mapMessages(messages: Message[]): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];

    for (const msg of messages) {
      if (msg.role === 'tool') {
        // Anthropic: tool results go as user messages with tool_result content blocks
        const toolResultBlock = {
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: getMessageText(msg.content),
        };

        // Merge consecutive tool results into one user message
        const last = result[result.length - 1];
        if (last && last.role === 'user' && Array.isArray(last.content)) {
          (last.content as Array<Record<string, unknown>>).push(toolResultBlock);
        } else {
          result.push({ role: 'user', content: [toolResultBlock] });
        }
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          // Assistant message with tool calls -> content blocks
          const contentBlocks: Array<Record<string, unknown>> = [];
          const text = getMessageText(msg.content);
          if (text) {
            contentBlocks.push({ type: 'text', text });
          }
          for (const tc of msg.toolCalls) {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.parameters,
            });
          }
          result.push({ role: 'assistant', content: contentBlocks });
        } else {
          result.push({ role: 'assistant', content: getMessageText(msg.content) });
        }
      } else {
        // user messages - handle multipart content
        if (Array.isArray(msg.content)) {
          const blocks: Array<Record<string, unknown>> = [];
          for (const part of msg.content) {
            if (part.type === 'text') {
              blocks.push({ type: 'text', text: part.text });
            } else if (part.type === 'image') {
              blocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: part.image.mimeType,
                  data: part.image.data,
                },
              });
            }
          }
          result.push({ role: 'user', content: blocks });
        } else {
          result.push({ role: 'user', content: msg.content });
        }
      }
    }

    // Ensure first message is user role
    if (result.length > 0 && result[0]!.role !== 'user') {
      result.unshift({ role: 'user', content: '(conversation start)' });
    }

    return result;
  }

  private mapTool(tool: ToolDefinition): Record<string, unknown> {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    };
  }

  async *chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: LLMCallOptions,
  ): AsyncIterable<LLMStreamChunk> {
    const body = this.buildRequestBody(messages, tools);
    body['stream'] = true;

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      ...(options?.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new LLMError(
        `Anthropic API error: ${response.status} ${errorBody}`,
        'anthropic',
        response.status,
      );
    }

    if (!response.body) {
      throw new LLMError('Anthropic streaming response has no body', 'anthropic');
    }

    yield* this.parseAnthropicSSE(response.body);
  }

  private async *parseAnthropicSSE(
    body: ReadableStream<Uint8Array>,
  ): AsyncIterable<LLMStreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls: ToolCall[] = [];
    let currentToolId = '';
    let currentToolName = '';
    let currentToolJson = '';
    let usage: LLMResponse['usage'] | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const payload = trimmed.slice(6);

          let data: Record<string, unknown>;
          try {
            data = JSON.parse(payload) as Record<string, unknown>;
          } catch {
            continue;
          }

          const eventType = data.type as string;

          if (eventType === 'content_block_delta') {
            const delta = data.delta as Record<string, unknown>;
            if (delta.type === 'text_delta') {
              yield { delta: delta.text as string, done: false };
            } else if (delta.type === 'input_json_delta') {
              currentToolJson += delta.partial_json as string;
            }
          } else if (eventType === 'content_block_start') {
            const block = data.content_block as Record<string, unknown>;
            if (block.type === 'tool_use') {
              currentToolId = block.id as string;
              currentToolName = block.name as string;
              currentToolJson = '';
            }
          } else if (eventType === 'content_block_stop') {
            if (currentToolId) {
              let parameters: Record<string, unknown> = {};
              try {
                parameters = JSON.parse(currentToolJson) as Record<string, unknown>;
              } catch { /* partial JSON */ }
              toolCalls.push({ id: currentToolId, name: currentToolName, parameters });
              currentToolId = '';
              currentToolName = '';
              currentToolJson = '';
            }
          } else if (eventType === 'message_delta') {
            const u = data.usage as Record<string, number> | undefined;
            if (u) {
              const outputTokens = u.output_tokens ?? 0;
              usage = {
                promptTokens: usage?.promptTokens ?? 0,
                completionTokens: outputTokens,
                totalTokens: (usage?.promptTokens ?? 0) + outputTokens,
              };
            }
          } else if (eventType === 'message_start') {
            const msg = data.message as Record<string, unknown> | undefined;
            const u = msg?.usage as Record<string, number> | undefined;
            if (u) {
              usage = {
                promptTokens: u.input_tokens ?? 0,
                completionTokens: u.output_tokens ?? 0,
                totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
              };
            }
          } else if (eventType === 'message_stop') {
            yield {
              delta: '',
              done: true,
              usage,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            };
            return;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      delta: '',
      done: true,
      usage,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private parseResponse(data: Record<string, unknown>): LLMResponse {
    const contentBlocks = data.content as Array<Record<string, unknown>>;
    if (!contentBlocks || contentBlocks.length === 0) {
      throw new LLMError('Anthropic API returned no content', 'anthropic');
    }

    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of contentBlocks) {
      if (block.type === 'text') {
        textContent += block.text as string;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id as string,
          name: block.name as string,
          parameters: (block.input as Record<string, unknown>) ?? {},
        });
      }
    }

    const usage = data.usage as Record<string, number> | undefined;
    const inputTokens = usage?.input_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? 0;

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    };
  }
}
