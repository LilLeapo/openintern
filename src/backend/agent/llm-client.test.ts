/**
 * LLM Client tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockLLMClient, createLLMClient } from './llm-client.js';
import type { Message, ToolDefinition } from '../../types/agent.js';

describe('MockLLMClient', () => {
  let client: MockLLMClient;

  beforeEach(() => {
    client = new MockLLMClient({
      provider: 'mock',
      model: 'test-model',
    });
  });

  it('should return default response', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
    ];

    const response = await client.chat(messages);

    expect(response.content).toBe('I have completed the task.');
    expect(response.usage.totalTokens).toBeGreaterThan(0);
  });

  it('should return predefined response for specific input', async () => {
    const customResponse = {
      content: 'Custom response',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };

    client.setResponse('test input', customResponse);

    const messages: Message[] = [
      { role: 'user', content: 'test input' },
    ];

    const response = await client.chat(messages);

    expect(response.content).toBe('Custom response');
  });

  it('should track call count', async () => {
    expect(client.getCallCount()).toBe(0);

    await client.chat([{ role: 'user', content: 'Hello' }]);
    expect(client.getCallCount()).toBe(1);

    await client.chat([{ role: 'user', content: 'World' }]);
    expect(client.getCallCount()).toBe(2);

    client.resetCallCount();
    expect(client.getCallCount()).toBe(0);
  });
});

describe('MockLLMClient with tools', () => {
  let client: MockLLMClient;
  let tools: ToolDefinition[];

  beforeEach(() => {
    client = new MockLLMClient(
      { provider: 'mock', model: 'test-model' },
      { simulateToolCalls: true }
    );

    tools = [
      {
        name: 'memory.write',
        description: 'Write to memory',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'memory.search',
        description: 'Search memory',
        parameters: { type: 'object', properties: {} },
      },
    ];
  });

  it('should simulate memory.write tool call', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Please remember this information' },
    ];

    const response = await client.chat(messages, tools);

    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls?.length).toBe(1);
    expect(response.toolCalls?.[0]?.name).toBe('memory.write');
  });

  it('should simulate memory.search tool call', async () => {
    const messages: Message[] = [
      { role: 'user', content: 'Search for something' },
    ];

    const response = await client.chat(messages, tools);

    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls?.length).toBe(1);
    expect(response.toolCalls?.[0]?.name).toBe('memory.search');
  });
});

describe('createLLMClient', () => {
  it('should create mock client', () => {
    const client = createLLMClient({
      provider: 'mock',
      model: 'test-model',
    });

    expect(client).toBeDefined();
  });

  it('should fall back to mock for unsupported providers', () => {
    const client = createLLMClient({
      provider: 'openai',
      model: 'gpt-4',
    });

    expect(client).toBeDefined();
  });
});
