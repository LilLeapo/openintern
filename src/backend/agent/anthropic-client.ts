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
import { LLMError } from '../../utils/errors.js';
import type { ILLMClient } from './llm-client.js';

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

  async chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse> {
    const body = this.buildRequestBody(messages, tools);

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
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
        systemMessages.push(msg.content);
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
          content: msg.content,
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
          // Assistant message with tool calls → content blocks
          const contentBlocks: Array<Record<string, unknown>> = [];
          if (msg.content) {
            contentBlocks.push({ type: 'text', text: msg.content });
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
          result.push({ role: 'assistant', content: msg.content });
        }
      } else {
        // user messages
        result.push({ role: 'user', content: msg.content });
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
