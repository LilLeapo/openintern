/**
 * RunQueue tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RunQueue } from './run-queue.js';
import type { QueuedRun } from '../../types/api.js';

function createMockRun(overrides: Partial<QueuedRun> = {}): QueuedRun {
  return {
    run_id: `run_${Math.random().toString(36).substring(2, 14)}`,
    session_key: 's_test',
    input: 'test input',
    agent_id: 'main',
    created_at: new Date().toISOString(),
    status: 'pending',
    ...overrides,
  };
}

describe('RunQueue', () => {
  let queue: RunQueue;

  beforeEach(() => {
    queue = new RunQueue({ autoProcess: false });
  });

  describe('enqueue', () => {
    it('should add a run to the queue', () => {
      const run = createMockRun();
      queue.enqueue(run);

      expect(queue.getQueueLength()).toBe(1);
      expect(queue.peek()?.run_id).toBe(run.run_id);
    });

    it('should emit run.enqueued event', () => {
      const run = createMockRun();
      const handler = vi.fn();
      queue.on('run.enqueued', handler);

      queue.enqueue(run);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        run_id: run.run_id,
        status: 'pending',
      }));
    });

    it('should throw when queue is full', () => {
      const smallQueue = new RunQueue({ maxSize: 2, autoProcess: false });
      smallQueue.enqueue(createMockRun());
      smallQueue.enqueue(createMockRun());

      expect(() => smallQueue.enqueue(createMockRun())).toThrow('Queue is full');
    });
  });

  describe('getStatus', () => {
    it('should return pending for queued runs', () => {
      const run = createMockRun();
      queue.enqueue(run);

      expect(queue.getStatus(run.run_id)).toBe('pending');
    });

    it('should return null for unknown runs', () => {
      expect(queue.getStatus('run_unknown')).toBeNull();
    });
  });

  describe('getRun', () => {
    it('should return the run by ID', () => {
      const run = createMockRun();
      queue.enqueue(run);

      const result = queue.getRun(run.run_id);
      expect(result?.run_id).toBe(run.run_id);
    });

    it('should return null for unknown runs', () => {
      expect(queue.getRun('run_unknown')).toBeNull();
    });
  });

  describe('cancel', () => {
    it('should remove a pending run from queue', () => {
      const run = createMockRun();
      queue.enqueue(run);

      const cancelled = queue.cancel(run.run_id);

      expect(cancelled).toBe(true);
      expect(queue.getQueueLength()).toBe(0);
    });

    it('should return false for unknown runs', () => {
      expect(queue.cancel('run_unknown')).toBe(false);
    });
  });

  describe('processQueue', () => {
    it('should execute runs serially', async () => {
      const executionOrder: string[] = [];
      const executor = vi.fn(async (run: QueuedRun) => {
        executionOrder.push(run.run_id);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      queue.setExecutor(executor);

      const run1 = createMockRun({ run_id: 'run_first' });
      const run2 = createMockRun({ run_id: 'run_second' });

      queue.enqueue(run1);
      queue.enqueue(run2);

      await queue.processQueue();

      expect(executionOrder).toEqual(['run_first', 'run_second']);
      expect(executor).toHaveBeenCalledTimes(2);
    });

    it('should emit run.started and run.completed events', async () => {
      const startedHandler = vi.fn();
      const completedHandler = vi.fn();

      queue.on('run.started', startedHandler);
      queue.on('run.completed', completedHandler);
      queue.setExecutor(async () => {});

      const run = createMockRun();
      queue.enqueue(run);

      await queue.processQueue();

      expect(startedHandler).toHaveBeenCalledWith(expect.objectContaining({
        run_id: run.run_id,
        status: 'running',
      }));
      expect(completedHandler).toHaveBeenCalledWith(expect.objectContaining({
        run_id: run.run_id,
        status: 'completed',
      }));
    });

    it('should emit run.failed on executor error', async () => {
      const failedHandler = vi.fn();
      queue.on('run.failed', failedHandler);
      queue.setExecutor(() => {
        return Promise.reject(new Error('Test error'));
      });

      const run = createMockRun();
      queue.enqueue(run);

      await queue.processQueue();

      expect(failedHandler).toHaveBeenCalledWith(expect.objectContaining({
        run_id: run.run_id,
        status: 'failed',
      }));
    });

    it('should continue processing after a run fails', async () => {
      const completedHandler = vi.fn();
      queue.on('run.completed', completedHandler);

      let callCount = 0;
      queue.setExecutor(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('First run fails'));
        }
        return Promise.resolve();
      });

      queue.enqueue(createMockRun());
      queue.enqueue(createMockRun());

      await queue.processQueue();

      expect(completedHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('timeout', () => {
    it('should fail run on timeout', async () => {
      const timeoutQueue = new RunQueue({
        autoProcess: false,
        timeoutMs: 50,
      });

      const failedHandler = vi.fn();
      timeoutQueue.on('run.failed', failedHandler);

      timeoutQueue.setExecutor(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      const run = createMockRun();
      timeoutQueue.enqueue(run);

      await timeoutQueue.processQueue();

      expect(failedHandler).toHaveBeenCalled();
    });
  });

  describe('getPendingRuns', () => {
    it('should return all pending runs', () => {
      const run1 = createMockRun();
      const run2 = createMockRun();

      queue.enqueue(run1);
      queue.enqueue(run2);

      const pending = queue.getPendingRuns();

      expect(pending).toHaveLength(2);
      expect(pending[0]?.run_id).toBe(run1.run_id);
      expect(pending[1]?.run_id).toBe(run2.run_id);
    });
  });

  describe('isEmpty', () => {
    it('should return true when queue is empty', () => {
      expect(queue.isEmpty()).toBe(true);
    });

    it('should return false when queue has items', () => {
      queue.enqueue(createMockRun());
      expect(queue.isEmpty()).toBe(false);
    });
  });
});
