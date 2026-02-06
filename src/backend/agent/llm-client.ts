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

/**
 * Abstract LLM Client interface
 */
export interface ILLMClient {
  chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse>;
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

  async chat(
    messages: Message[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse> {
    this.callCount++;

    // Simulate some delay
    await new Promise((resolve) => setTimeout(resolve, 10));

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

  private generateToolCallResponse(
    tools: ToolDefinition[],
    userInput: string
  ): LLMResponse {
    // Check if user input mentions memory operations
    const lowerInput = userInput.toLowerCase();

    if (lowerInput.includes('remember') || lowerInput.includes('save')) {
      const memoryWriteTool = tools.find((t) => t.name === 'memory.write');
      if (memoryWriteTool) {
        const toolCall: ToolCall = {
          id: `tc_${Date.now()}`,
          name: 'memory.write',
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
      const memorySearchTool = tools.find((t) => t.name === 'memory.search');
      if (memorySearchTool) {
        const toolCall: ToolCall = {
          id: `tc_${Date.now()}`,
          name: 'memory.search',
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
    case 'anthropic':
      // For MVP, fall back to mock
      logger.warn('Real LLM providers not implemented, using mock', {
        provider: config.provider,
      });
      return new MockLLMClient(config);
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unknown LLM provider: ${String(exhaustiveCheck)}`);
    }
  }
}
