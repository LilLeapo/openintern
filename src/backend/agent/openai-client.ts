/**
 * OpenAI LLM Client - Uses native fetch to call OpenAI-compatible APIs
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

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAIClient implements ILLMClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new LLMError(
        'OpenAI API key is required. Set apiKey in config or OPENAI_API_KEY env var.',
        'openai'
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

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new LLMError(
        `OpenAI API error: ${response.status} ${errorBody}`,
        'openai',
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
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => this.mapMessage(m)),
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => this.mapTool(t));
    }

    return body;
  }

  private mapMessage(msg: Message): Record<string, unknown> {
    const mapped: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
    };

    if (msg.role === 'tool' && msg.toolCallId) {
      mapped.tool_call_id = msg.toolCallId;
    }

    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      mapped.tool_calls = msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.parameters),
        },
      }));
    }

    if (msg.name) {
      mapped.name = msg.name;
    }

    return mapped;
  }

  private mapTool(tool: ToolDefinition): Record<string, unknown> {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }

  private parseResponse(data: Record<string, unknown>): LLMResponse {
    const choices = data.choices as Array<Record<string, unknown>>;
    if (!choices || choices.length === 0) {
      throw new LLMError('OpenAI API returned no choices', 'openai');
    }

    const choice = choices[0]!;
    const message = choice.message as Record<string, unknown>;
    const content = (message.content as string) ?? '';

    // Parse tool calls
    let toolCalls: ToolCall[] | undefined;
    const rawToolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;
    if (rawToolCalls && rawToolCalls.length > 0) {
      toolCalls = rawToolCalls.map((tc) => {
        const fn = tc.function as Record<string, unknown>;
        let parameters: Record<string, unknown> = {};
        try {
          parameters = JSON.parse(fn.arguments as string) as Record<string, unknown>;
        } catch {
          // If JSON parsing fails, use empty object
        }
        return {
          id: tc.id as string,
          name: fn.name as string,
          parameters,
        };
      });
    }

    // Parse usage
    const usage = data.usage as Record<string, number> | undefined;
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;

    return {
      content,
      toolCalls,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }
}
