/**
 * AgentLoop tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { AgentLoop } from './agent-loop.js';
import { EventStore } from '../store/event-store.js';
import type { ILLMClient } from './llm-client.js';
import type { Event } from '../../types/events.js';

describe('AgentLoop', () => {
  const testDir = '/tmp/test-agent-loop-' + Date.now();
  const sessionKey = 's_test';
  const runId = 'run_test123';

  beforeEach(async () => {
    await fs.promises.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  describe('Initialization', () => {
    it('should initialize with default config', () => {
      const loop = new AgentLoop(runId, sessionKey, {}, testDir);
      const status = loop.getStatus();

      expect(status.status).toBe('idle');
      expect(status.currentStep).toBe(0);
      expect(status.maxSteps).toBe(10);
    });

    it('should initialize with custom config', () => {
      const loop = new AgentLoop(runId, sessionKey, { maxSteps: 5 }, testDir);
      const status = loop.getStatus();

      expect(status.maxSteps).toBe(5);
    });
  });

  describe('Execution', () => {
    it('should execute and complete', async () => {
      const loop = new AgentLoop(runId, sessionKey, { maxSteps: 3 }, testDir);
      const events: Event[] = [];

      loop.setEventCallback((event) => {
        events.push(event);
      });

      await loop.execute('Hello, agent!');

      const status = loop.getStatus();
      expect(status.status).toBe('completed');
      expect(events.length).toBeGreaterThan(0);
    });

    it('should emit run.started event', async () => {
      const loop = new AgentLoop(runId, sessionKey, { maxSteps: 1 }, testDir);
      const events: Event[] = [];

      loop.setEventCallback((event) => {
        events.push(event);
      });

      await loop.execute('Test input');

      const startEvent = events.find(e => e.type === 'run.started');
      expect(startEvent).toBeDefined();
      expect(startEvent?.payload).toHaveProperty('input', 'Test input');
    });

    it('should emit run.completed event', async () => {
      const loop = new AgentLoop(runId, sessionKey, { maxSteps: 1 }, testDir);
      const events: Event[] = [];

      loop.setEventCallback((event) => {
        events.push(event);
      });

      await loop.execute('Test');

      const completeEvent = events.find(e => e.type === 'run.completed');
      expect(completeEvent).toBeDefined();
    });
  });

  describe('Abort', () => {
    it('should abort execution', () => {
      const loop = new AgentLoop(runId, sessionKey, {}, testDir);
      loop.abort();
      // Abort flag is set internally
      expect(loop.getStatus().status).toBe('idle');
    });
  });

  describe('Event storage', () => {
    it('should store events to file', async () => {
      const loop = new AgentLoop(runId, sessionKey, { maxSteps: 1 }, testDir);
      await loop.execute('Test');

      // Check events file exists
      const eventsPath = `${testDir}/sessions/${sessionKey}/runs/${runId}/events.jsonl`;
      const exists = await fs.promises.access(eventsPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should stream llm.token events and persist them in order', async () => {
      const loop = new AgentLoop(runId, sessionKey, { maxSteps: 1 }, testDir);
      const events: Event[] = [];
      const streamedTokens = ['Hello', ' ', 'world', '!'];

      loop.setEventCallback((event) => {
        events.push(event);
      });

      const streamingClient: ILLMClient = {
        chat: async () => {
          throw new Error('chat() should not be called when chatStream() is available');
        },
        async *chatStream() {
          for (const token of streamedTokens) {
            yield { delta: token, done: false };
          }
          yield {
            delta: '',
            done: true,
            usage: {
              promptTokens: 3,
              completionTokens: 4,
              totalTokens: 7,
            },
          };
        },
      };

      (loop as unknown as { llmClient: ILLMClient }).llmClient = streamingClient;
      await loop.execute('stream test');

      const streamed = events.filter((event) => event.type === 'llm.token');
      expect(streamed.length).toBe(streamedTokens.length);
      expect(
        streamed.map((event) => (event.payload as { token: string }).token).join('')
      ).toBe('Hello world!');

      const eventStore = new EventStore(sessionKey, runId, testDir);
      const persisted = await eventStore.readAll();
      const persistedTokens = persisted.filter((event) => event.type === 'llm.token');
      expect(persistedTokens.length).toBe(streamedTokens.length);

      const lastTokenIdx = persisted.findLastIndex((event) => event.type === 'llm.token');
      const completedIdx = persisted.findIndex((event) => event.type === 'run.completed');
      expect(lastTokenIdx).toBeGreaterThanOrEqual(0);
      expect(completedIdx).toBeGreaterThan(lastTokenIdx);
    });
  });
});
