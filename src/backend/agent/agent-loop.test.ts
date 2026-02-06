/**
 * AgentLoop tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { AgentLoop } from './agent-loop.js';
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
  });
});