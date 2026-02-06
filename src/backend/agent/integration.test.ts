/**
 * Agent Integration tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { AgentLoop } from './agent-loop.js';
import { EventStore } from '../store/event-store.js';
import type { Event } from '../../types/events.js';

describe('Agent Integration', () => {
  const testDir = '/tmp/test-agent-integration-' + Date.now();
  const sessionKey = 's_integration';
  const runId = 'run_integ123';

  beforeEach(async () => {
    await fs.promises.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  describe('End-to-end execution', () => {
    it('should complete full run cycle', async () => {
      const loop = new AgentLoop(runId, sessionKey, { maxSteps: 3 }, testDir);
      const collectedEvents: Event[] = [];

      loop.setEventCallback((event) => {
        collectedEvents.push(event);
      });

      await loop.execute('Hello, please help me.');

      // Verify status
      const status = loop.getStatus();
      expect(status.status).toBe('completed');

      // Verify events were emitted
      expect(collectedEvents.length).toBeGreaterThan(0);

      // Verify run.started event
      const startEvent = collectedEvents.find(e => e.type === 'run.started');
      expect(startEvent).toBeDefined();

      // Verify run.completed event
      const completeEvent = collectedEvents.find(e => e.type === 'run.completed');
      expect(completeEvent).toBeDefined();
    });
  });

  describe('Event persistence', () => {
    it('should persist events to EventStore', async () => {
      const loop = new AgentLoop(runId, sessionKey, { maxSteps: 1 }, testDir);
      await loop.execute('Test persistence');

      // Read events from store
      const eventStore = new EventStore(sessionKey, runId, testDir);
      const events = await eventStore.readAll();

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.type).toBe('run.started');
    });
  });
});