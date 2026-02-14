/**
 * LLM Client - Interface for calling LLM APIs
 *
 * Features:
 * - Mock provider for testing
 * - Extensible for real LLM providers (OpenAI, Anthropic)
 * - Tool call format parsing
 * - Usage tracking
 */

import type {
  LLMConfig,
  LLMResponse,
  Message,
  ToolDefinition,
  ToolCall,
} from '../../types/agent.js';
import { logger } from '../../utils/logger.js';
import { OpenAIClient } from './openai-client.js';
import { AnthropicClient } from './anthropic-client.js';
import { GeminiClient } from './gemini-client.js';

export interface LLMCallOptions {
  signal?: AbortSignal;
}

/**
 * Streaming chunk from LLM
 */
export interface LLMStreamChunk {
  /** Incremental text content */
  delta: string;
  /** Tool calls discovered so far (only on final chunk or when complete) */
  toolCalls?: ToolCall[] | undefined;
  /** Usage info (only on final chunk) */
  usage?: LLMResponse['usage'] | undefined;
  /** Whether this is the final chunk */
  done: boolean;
}

/**
 * Abstract LLM Client interface
 */
export interface ILLMClient {
  chat(messages: Message[], tools?: ToolDefinition[], options?: LLMCallOptions): Promise<LLMResponse>;
  chatStream?(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: LLMCallOptions,
  ): AsyncIterable<LLMStreamChunk>;
}

/**
 * Mock LLM response generator for testing
 */
interface MockResponseConfig {
  /** Default response when no tool calls */
  defaultResponse: string;
  /** Responses for specific inputs */
  responses: Map<string, LLMResponse>;
  /** Whether to simulate tool calls */
  simulateToolCalls: boolean;
}

const DEFAULT_MOCK_CONFIG: MockResponseConfig = {
  defaultResponse: 'I have completed the task.',
  responses: new Map(),
  simulateToolCalls: false,
};

/**
 * Mock LLM Client for testing
 */
export class MockLLMClient implements ILLMClient {
  private config: LLMConfig;
  private mockConfig: MockResponseConfig;
  private callCount = 0;

  constructor(
    config: LLMConfig,
    mockConfig: Partial<MockResponseConfig> = {}
  ) {
    this.config = config;
    this.mockConfig = { ...DEFAULT_MOCK_CONFIG, ...mockConfig };
  }

  /**
   * Set a mock response for a specific input
   */
  setResponse(input: string, response: LLMResponse): void {
    this.mockConfig.responses.set(input, response);
  }

  /**
   * Set whether to simulate tool calls
   */
  setSimulateToolCalls(simulate: boolean): void {
    this.mockConfig.simulateToolCalls = simulate;
  }

  /**
   * Get the number of calls made
   */
  getCallCount(): number {
    return this.callCount;
  }

  /**
   * Reset call count
   */
  resetCallCount(): void {
    this.callCount = 0;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      const err = new Error('LLM call aborted');
      err.name = 'AbortError';
      throw err;
    }
  }

  private async delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('LLM call aborted'), { name: 'AbortError' }));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: LLMCallOptions,
  ): Promise<LLMResponse> {
    this.throwIfAborted(options?.signal);
    this.callCount++;

    // Simulate some delay
    await this.delay(10, options?.signal);
    this.throwIfAborted(options?.signal);

    // Get the last user message
    const lastUserMessage = messages
      .filter((m) => m.role === 'user')
      .pop();

    const userInput = lastUserMessage?.content ?? '';

    logger.debug('MockLLMClient.chat called', {
      messageCount: messages.length,
      toolCount: tools?.length ?? 0,
      userInput: userInput.substring(0, 100),
    });

    // Check for predefined response
    if (this.mockConfig.responses.has(userInput)) {
      return this.mockConfig.responses.get(userInput)!;
    }

    // Simulate tool calls if enabled and tools are available
    if (this.mockConfig.simulateToolCalls && tools && tools.length > 0) {
      return this.generateToolCallResponse(tools, userInput);
    }

    // Return default response
    return this.generateDefaultResponse();
  }

  async *chatStream(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: LLMCallOptions,
  ): AsyncIterable<LLMStreamChunk> {
    const response = await this.chat(messages, tools, options);
    this.throwIfAborted(options?.signal);

    // Stream by whitespace-preserving chunks for responsive UI updates.
    const chunks = response.content ? response.content.split(/(\s+)/).filter((part) => part.length > 0) : [];
    for (const chunk of chunks) {
      this.throwIfAborted(options?.signal);
      yield { delta: chunk, done: false };
    }

    yield {
      delta: '',
      done: true,
      toolCalls: response.toolCalls,
      usage: response.usage,
    };
  }

  private generateToolCallResponse(
    tools: ToolDefinition[],
    userInput: string
  ): LLMResponse {
    // Check if user input mentions memory operations
    const lowerInput = userInput.toLowerCase();

    if (lowerInput.includes('remember') || lowerInput.includes('save')) {
      const memoryWriteTool = tools.find((t) => t.name === 'memory_write');
      if (memoryWriteTool) {
        const toolCall: ToolCall = {
          id: `tc_${Date.now()}`,
          name: 'memory_write',
          parameters: {
            content: userInput,
            tags: ['user-request'],
          },
        };

        return {
          content: 'I will save this to memory.',
          toolCalls: [toolCall],
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        };
      }
    }

    if (lowerInput.includes('search') || lowerInput.includes('find')) {
      const memorySearchTool = tools.find((t) => t.name === 'memory_search');
      if (memorySearchTool) {
        const toolCall: ToolCall = {
          id: `tc_${Date.now()}`,
          name: 'memory_search',
          parameters: {
            query: userInput,
            topK: 5,
          },
        };

        return {
          content: 'Let me search for that.',
          toolCalls: [toolCall],
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        };
      }
    }

    // Default: return final answer
    return this.generateDefaultResponse();
  }

  private generateDefaultResponse(): LLMResponse {
    return {
      content: this.mockConfig.defaultResponse,
      usage: {
        promptTokens: 50,
        completionTokens: 20,
        totalTokens: 70,
      },
    };
  }
}

/**
 * LLM Client factory
 */
export function createLLMClient(config: LLMConfig): ILLMClient {
  switch (config.provider) {
    case 'mock':
      return new MockLLMClient(config);
    case 'openai':
      return new OpenAIClient(config);
    case 'anthropic':
      return new AnthropicClient(config);
    case 'gemini':
      return new GeminiClient(config);
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unknown LLM provider: ${String(exhaustiveCheck)}`);
    }
  }
}
