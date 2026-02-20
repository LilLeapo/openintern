import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '../../types/events.js';
import { EventSchema } from '../../types/events.js';
import type { LLMResponse } from '../../types/agent.js';
import { createLLMClient } from '../agent/llm-client.js';
import { SingleAgentRunner, type RunnerContext } from './agent-runner.js';

vi.mock('../agent/llm-client.js', () => ({
  createLLMClient: vi.fn(),
}));

const mockedCreateLLMClient = vi.mocked(createLLMClient);

const runnerContext: RunnerContext = {
  runId: 'run_test123456',
  sessionKey: 's_test',
  scope: {
    orgId: 'org_test',
    userId: 'user_test',
    projectId: null,
  },
  agentId: 'main',
};

function usage(): LLMResponse['usage'] {
  return {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
  };
}

function nthIndexOf(items: string[], target: string, n: number): number {
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i] === target) {
      count++;
      if (count === n) {
        return i;
      }
    }
  }
  return -1;
}

async function collectRun(
  runner: SingleAgentRunner,
  input: string,
  ctx: RunnerContext,
  timeline: string[]
): Promise<{
  events: Event[];
  result: Awaited<ReturnType<SingleAgentRunner['run']> extends AsyncGenerator<Event, infer R, void> ? R : never>;
}> {
  const iterator = runner.run(input, ctx);
  const events: Event[] = [];

  while (true) {
    const next = await iterator.next();
    if (next.done) {
      return {
        events,
        result: next.value,
      };
    }
    timeline.push(`event:${next.value.type}`);
    const parsed = EventSchema.safeParse(next.value);
    expect(parsed.success).toBe(true);
    events.push(next.value);
  }
}

function assertEventMetadata(events: Event[]): void {
  expect(events.length).toBeGreaterThan(0);
  const parentSpans = new Set(events.map((event) => event.parent_span_id));

  for (const event of events) {
    expect(event.agent_id).toBe('main');
    expect(event.span_id).toMatch(/^sp_[A-Za-z0-9]+$/);
    expect(event.step_id).toMatch(/^step_[0-9]{4}$/);
    expect(event.parent_span_id).toMatch(/^sp_[A-Za-z0-9]+$/);
  }

  // all events in one run should share the same root parent span
  expect(parentSpans.size).toBe(1);
}

describe('SingleAgentRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves step order without tool calls and saves checkpoint before step.completed', async () => {
    const timeline: string[] = [];
    const memoryService = {
      memory_search: vi.fn(async () => {
        timeline.push('memory_search');
        return [];
      }),
      memory_search_pa: vi.fn(async () => {
        timeline.push('memory_search');
        return [];
      }),
      memory_search_tiered: vi.fn(async () => []),
    };
    const checkpointService = {
      save: vi.fn(async () => {
        timeline.push('checkpoint.saved');
      }),
    };
    const toolRouter = {
      listTools: vi.fn(() => []),
      listSkills: vi.fn(() => []),
      callTool: vi.fn(async () => ({
        success: true,
        result: {},
        duration: 1,
      })),
    };
    const chat = vi.fn(async () => {
      timeline.push('model');
      return {
        content: 'final answer',
        usage: usage(),
      };
    });
    mockedCreateLLMClient.mockReturnValue({ chat });

    const runner = new SingleAgentRunner({
      maxSteps: 3,
      modelConfig: { provider: 'mock', model: 'mock-model' },
      checkpointService: checkpointService as never,
      memoryService: memoryService as never,
      toolRouter: toolRouter as never,
    });

    const { events, result } = await collectRun(
      runner,
      'hello',
      runnerContext,
      timeline
    );

    expect(result.status).toBe('completed');
    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'step.started',
      'llm.called',
      'step.completed',
      'run.completed',
    ]);

    const stepCompleted = events.find(
      (event) => event.type === 'step.completed'
    );
    expect(stepCompleted?.payload.resultType).toBe('final_answer');

    expect(nthIndexOf(timeline, 'event:step.started', 1)).toBeLessThan(
      nthIndexOf(timeline, 'memory_search', 1)
    );
    expect(nthIndexOf(timeline, 'memory_search', 1)).toBeLessThan(
      nthIndexOf(timeline, 'model', 1)
    );
    expect(nthIndexOf(timeline, 'model', 1)).toBeLessThan(
      nthIndexOf(timeline, 'checkpoint.saved', 1)
    );
    expect(nthIndexOf(timeline, 'checkpoint.saved', 1)).toBeLessThan(
      nthIndexOf(timeline, 'event:step.completed', 1)
    );

    expect(checkpointService.save).toHaveBeenCalledTimes(1);
    expect(toolRouter.callTool).not.toHaveBeenCalled();
    assertEventMetadata(events);
  });

  it('preserves step order with tool calls across multiple steps', async () => {
    const timeline: string[] = [];
    const memoryService = {
      memory_search: vi.fn(async () => {
        timeline.push('memory_search');
        return [];
      }),
      memory_search_pa: vi.fn(async () => {
        timeline.push('memory_search');
        return [];
      }),
      memory_search_tiered: vi.fn(async () => []),
    };
    const checkpointService = {
      save: vi.fn(async () => {
        timeline.push('checkpoint.saved');
      }),
    };
    const toolRouter = {
      listTools: vi.fn(() => [
        {
          name: 'read_file',
          description: 'read file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ]),
      listSkills: vi.fn(() => []),
      callTool: vi.fn(async () => {
        timeline.push('tool.execute');
        return {
          success: true,
          result: { content: 'ok' },
          duration: 1,
        };
      }),
    };
    const chat = vi
      .fn()
      .mockImplementationOnce(async () => {
        timeline.push('model');
        return {
          content: 'need tool',
          usage: usage(),
          toolCalls: [
            {
              id: 'tc_1',
              name: 'read_file',
              parameters: { path: 'README.md' },
            },
          ],
        };
      })
      .mockImplementationOnce(async () => {
        timeline.push('model');
        return {
          content: 'done',
          usage: usage(),
        };
      });
    mockedCreateLLMClient.mockReturnValue({ chat });

    const runner = new SingleAgentRunner({
      maxSteps: 3,
      modelConfig: { provider: 'mock', model: 'mock-model' },
      checkpointService: checkpointService as never,
      memoryService: memoryService as never,
      toolRouter: toolRouter as never,
    });

    const { events, result } = await collectRun(
      runner,
      'read something',
      runnerContext,
      timeline
    );

    expect(result.status).toBe('completed');
    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'step.started',
      'llm.called',
      'tool.batch.started',
      'tool.called',
      'tool.result',
      'tool.batch.completed',
      'step.completed',
      'step.started',
      'llm.called',
      'step.completed',
      'run.completed',
    ]);

    const stepCompletedEvents = events.filter(
      (event) => event.type === 'step.completed'
    );
    expect(stepCompletedEvents).toHaveLength(2);
    expect(stepCompletedEvents[0]?.payload.resultType).toBe('tool_call');
    expect(stepCompletedEvents[1]?.payload.resultType).toBe('final_answer');

    // Step 1: step.started -> memory_search -> model -> tool -> checkpoint.saved -> step.completed
    expect(nthIndexOf(timeline, 'event:step.started', 1)).toBeLessThan(
      nthIndexOf(timeline, 'memory_search', 1)
    );
    expect(nthIndexOf(timeline, 'memory_search', 1)).toBeLessThan(
      nthIndexOf(timeline, 'model', 1)
    );
    expect(nthIndexOf(timeline, 'model', 1)).toBeLessThan(
      nthIndexOf(timeline, 'tool.execute', 1)
    );
    expect(nthIndexOf(timeline, 'tool.execute', 1)).toBeLessThan(
      nthIndexOf(timeline, 'checkpoint.saved', 1)
    );
    expect(nthIndexOf(timeline, 'checkpoint.saved', 1)).toBeLessThan(
      nthIndexOf(timeline, 'event:step.completed', 1)
    );

    // Step 2: step.started -> memory_search -> model -> checkpoint.saved -> step.completed
    expect(nthIndexOf(timeline, 'event:step.started', 2)).toBeLessThan(
      nthIndexOf(timeline, 'memory_search', 2)
    );
    expect(nthIndexOf(timeline, 'memory_search', 2)).toBeLessThan(
      nthIndexOf(timeline, 'model', 2)
    );
    expect(nthIndexOf(timeline, 'model', 2)).toBeLessThan(
      nthIndexOf(timeline, 'checkpoint.saved', 2)
    );
    expect(nthIndexOf(timeline, 'checkpoint.saved', 2)).toBeLessThan(
      nthIndexOf(timeline, 'event:step.completed', 2)
    );

    expect(checkpointService.save).toHaveBeenCalledTimes(2);
    expect(toolRouter.callTool).toHaveBeenCalledTimes(1);
    assertEventMetadata(events);
  });

  it('emits run.failed when max steps is reached', async () => {
    const timeline: string[] = [];
    const memoryService = {
      memory_search: vi.fn(async () => {
        timeline.push('memory_search');
        return [];
      }),
      memory_search_pa: vi.fn(async () => {
        timeline.push('memory_search');
        return [];
      }),
      memory_search_tiered: vi.fn(async () => []),
    };
    const checkpointService = {
      save: vi.fn(async () => {
        timeline.push('checkpoint.saved');
      }),
    };
    const toolRouter = {
      listTools: vi.fn(() => [
        {
          name: 'read_file',
          description: 'read file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ]),
      listSkills: vi.fn(() => []),
      callTool: vi.fn(async () => ({
        success: true,
        result: { content: 'ok' },
        duration: 1,
      })),
    };
    const chat = vi.fn(async () => ({
      content: 'need tool',
      usage: usage(),
      toolCalls: [
        {
          id: 'tc_1',
          name: 'read_file',
          parameters: { path: 'README.md' },
        },
      ],
    }));
    mockedCreateLLMClient.mockReturnValue({ chat });

    const runner = new SingleAgentRunner({
      maxSteps: 1,
      modelConfig: { provider: 'mock', model: 'mock-model' },
      checkpointService: checkpointService as never,
      memoryService: memoryService as never,
      toolRouter: toolRouter as never,
    });

    const { events, result } = await collectRun(
      runner,
      'never final',
      runnerContext,
      timeline
    );

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Max steps (1) reached');
    expect(events.some((event) => event.type === 'run.completed')).toBe(false);
    const failed = events.find((event) => event.type === 'run.failed');
    expect(failed).toBeDefined();
    expect(failed?.payload.error.message).toContain('Max steps (1) reached');
    assertEventMetadata(events);
  });

  it('injects skill catalog into system message for model context', async () => {
    const memoryService = {
      memory_search: vi.fn(async () => []),
      memory_search_pa: vi.fn(async () => []),
      memory_search_tiered: vi.fn(async () => []),
    };
    const checkpointService = {
      save: vi.fn(async () => undefined),
    };
    const toolRouter = {
      listTools: vi.fn(() => []),
      listSkills: vi.fn(() => [
        {
          id: 'skill_fs',
          name: 'File Skill',
          description: 'File operations',
          tools: [{ name: 'read_file', description: '', parameters: {} }],
          risk_level: 'low',
          provider: 'builtin',
          health_status: 'healthy',
          allow_implicit_invocation: false,
        },
      ]),
      callTool: vi.fn(async () => ({
        success: true,
        result: {},
        duration: 1,
      })),
    };
    const chat = vi.fn(async () => ({
      content: 'done',
      usage: usage(),
    }));
    mockedCreateLLMClient.mockReturnValue({ chat });

    const runner = new SingleAgentRunner({
      maxSteps: 2,
      modelConfig: { provider: 'mock', model: 'mock-model' },
      checkpointService: checkpointService as never,
      memoryService: memoryService as never,
      toolRouter: toolRouter as never,
    });

    const timeline: string[] = [];
    await collectRun(runner, 'hello', runnerContext, timeline);

    expect(chat).toHaveBeenCalled();
    const firstCall = chat.mock.calls.at(0);
    const firstCallArgs = (firstCall as unknown[] | undefined) ?? [];
    const firstCallMessages = (firstCallArgs[0] as Array<{ role: string; content: string }> | undefined) ?? [];
    expect(firstCallMessages?.[0]?.role).toBe('system');
    expect(firstCallMessages?.[0]?.content).toContain('Skill catalog');
    expect(firstCallMessages?.[0]?.content).toContain('skill_fs');
    expect(firstCallMessages?.[0]?.content).toContain('read_file');
  });

  it('emits run.failed when model throws instead of hanging silently', async () => {
    const timeline: string[] = [];
    const memoryService = {
      memory_search: vi.fn(async () => {
        timeline.push('memory_search');
        return [];
      }),
      memory_search_pa: vi.fn(async () => {
        timeline.push('memory_search');
        return [];
      }),
      memory_search_tiered: vi.fn(async () => []),
    };
    const checkpointService = {
      save: vi.fn(async () => {
        timeline.push('checkpoint.saved');
      }),
    };
    const toolRouter = {
      listTools: vi.fn(() => []),
      listSkills: vi.fn(() => []),
      callTool: vi.fn(async () => ({
        success: true,
        result: {},
        duration: 1,
      })),
    };
    const chat = vi.fn(async () => {
      throw new Error('model unavailable');
    });
    mockedCreateLLMClient.mockReturnValue({ chat });

    const runner = new SingleAgentRunner({
      maxSteps: 3,
      modelConfig: { provider: 'mock', model: 'mock-model' },
      checkpointService: checkpointService as never,
      memoryService: memoryService as never,
      toolRouter: toolRouter as never,
    });

    const { events, result } = await collectRun(
      runner,
      'fail fast',
      runnerContext,
      timeline
    );

    expect(result.status).toBe('failed');
    expect(result.error).toContain('model unavailable');
    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'step.started',
      'run.failed',
    ]);
    expect(checkpointService.save).not.toHaveBeenCalled();
    assertEventMetadata(events);
  });

  it('streams llm.token events before llm.called when streaming is available', async () => {
    const memoryService = {
      memory_search: vi.fn(async () => []),
      memory_search_pa: vi.fn(async () => []),
      memory_search_tiered: vi.fn(async () => []),
    };
    const checkpointService = {
      save: vi.fn(async () => undefined),
    };
    const toolRouter = {
      listTools: vi.fn(() => []),
      listSkills: vi.fn(() => []),
      callTool: vi.fn(async () => ({
        success: true,
        result: {},
        duration: 1,
      })),
    };
    const chat = vi.fn(async () => ({
      content: 'fallback',
      usage: usage(),
    }));
    const chatStream = vi.fn(async function* () {
      yield { delta: 'hello', done: false };
      yield { delta: ' world', done: false };
      yield { delta: '', done: true, usage: usage() };
    });
    mockedCreateLLMClient.mockReturnValue({ chat, chatStream });

    const runner = new SingleAgentRunner({
      maxSteps: 2,
      modelConfig: { provider: 'mock', model: 'mock-model' },
      checkpointService: checkpointService as never,
      memoryService: memoryService as never,
      toolRouter: toolRouter as never,
    });

    const { events, result } = await collectRun(runner, 'stream please', runnerContext, []);

    expect(result.status).toBe('completed');
    expect(chat).not.toHaveBeenCalled();
    const tokenEvents = events.filter((event) => event.type === 'llm.token');
    expect(tokenEvents.length).toBe(2);
    expect(
      tokenEvents.map((event) => (event.payload as { token: string }).token).join('')
    ).toBe('hello world');
    expect(events.findIndex((event) => event.type === 'llm.token')).toBeLessThan(
      events.findIndex((event) => event.type === 'llm.called')
    );
  });

  it('emits RUN_CANCELLED when abort signal is already cancelled', async () => {
    const memoryService = {
      memory_search: vi.fn(async () => []),
      memory_search_pa: vi.fn(async () => []),
      memory_search_tiered: vi.fn(async () => []),
    };
    const checkpointService = {
      save: vi.fn(async () => undefined),
    };
    const toolRouter = {
      listTools: vi.fn(() => []),
      listSkills: vi.fn(() => []),
      callTool: vi.fn(async () => ({
        success: true,
        result: {},
        duration: 1,
      })),
    };
    const chat = vi.fn(async () => ({
      content: 'should not happen',
      usage: usage(),
    }));
    mockedCreateLLMClient.mockReturnValue({ chat });

    const runner = new SingleAgentRunner({
      maxSteps: 2,
      modelConfig: { provider: 'mock', model: 'mock-model' },
      checkpointService: checkpointService as never,
      memoryService: memoryService as never,
      toolRouter: toolRouter as never,
    });

    const controller = new AbortController();
    controller.abort();
    const { events, result } = await collectRun(
      runner,
      'cancel me',
      {
        ...runnerContext,
        abortSignal: controller.signal,
      },
      []
    );

    expect(result.status).toBe('failed');
    expect(result.error).toContain('cancelled');
    expect(events.map((event) => event.type)).toEqual(['run.started', 'run.failed']);
    const failed = events.find((event) => event.type === 'run.failed');
    expect(failed?.payload.error.code).toBe('RUN_CANCELLED');
    expect(chat).not.toHaveBeenCalled();
  });
});
