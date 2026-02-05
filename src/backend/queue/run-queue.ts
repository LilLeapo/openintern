/**
 * RunQueue - Memory queue for serial run execution
 *
 * Features:
 * - Run-level serial execution (one run at a time)
 * - Queue management: enqueue, dequeue, peek
 * - Status tracking: pending, running, completed, failed
 * - Event emission for queue state changes
 */

import { EventEmitter } from 'node:events';
import type { QueuedRun } from '../../types/api.js';
import { logger } from '../../utils/logger.js';

/**
 * Queue event types
 */
export type QueueEventType =
  | 'run.enqueued'
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'queue.empty';

/**
 * Queue event handler type
 */
export type QueueEventHandler = (run: QueuedRun) => void;

/**
 * Run executor function type
 */
export type RunExecutor = (run: QueuedRun) => Promise<void>;

/**
 * Queue configuration
 */
export interface QueueConfig {
  /** Maximum queue size (0 = unlimited) */
  maxSize: number;
  /** Run execution timeout in milliseconds */
  timeoutMs: number;
  /** Whether to auto-process queue */
  autoProcess: boolean;
}

const DEFAULT_CONFIG: QueueConfig = {
  maxSize: 100,
  timeoutMs: 300000, // 5 minutes
  autoProcess: true,
};

/**
 * RunQueue class for managing run execution
 */
export class RunQueue extends EventEmitter {
  private queue: QueuedRun[] = [];
  private runningRun: QueuedRun | null = null;
  private completedRuns: Map<string, QueuedRun> = new Map();
  private config: QueueConfig;
  private executor: RunExecutor | null = null;
  private processing = false;

  constructor(config: Partial<QueueConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the run executor function
   */
  setExecutor(executor: RunExecutor): void {
    this.executor = executor;
  }

  /**
   * Enqueue a new run
   */
  enqueue(run: QueuedRun): void {
    // Check queue size limit
    if (this.config.maxSize > 0 && this.queue.length >= this.config.maxSize) {
      throw new Error(`Queue is full (max: ${this.config.maxSize})`);
    }

    // Ensure status is pending
    const queuedRun: QueuedRun = {
      ...run,
      status: 'pending',
    };

    this.queue.push(queuedRun);
    this.emit('run.enqueued', queuedRun);
    logger.info('Run enqueued', { runId: run.run_id, queueLength: this.queue.length });

    // Auto-process if enabled
    if (this.config.autoProcess && !this.processing) {
      void this.processQueue();
    }
  }

  /**
   * Dequeue the next run (internal use)
   */
  private dequeue(): QueuedRun | null {
    return this.queue.shift() ?? null;
  }

  /**
   * Peek at the next run without removing it
   */
  peek(): QueuedRun | null {
    return this.queue[0] ?? null;
  }

  /**
   * Get the status of a run by ID
   */
  getStatus(runId: string): QueuedRun['status'] | null {
    // Check if currently running
    if (this.runningRun?.run_id === runId) {
      return 'running';
    }

    // Check completed runs
    const completed = this.completedRuns.get(runId);
    if (completed) {
      return completed.status;
    }

    // Check queue
    const queued = this.queue.find((r) => r.run_id === runId);
    if (queued) {
      return 'pending';
    }

    return null;
  }

  /**
   * Get full run info by ID
   */
  getRun(runId: string): QueuedRun | null {
    // Check if currently running
    if (this.runningRun?.run_id === runId) {
      return this.runningRun;
    }

    // Check completed runs
    const completed = this.completedRuns.get(runId);
    if (completed) {
      return completed;
    }

    // Check queue
    const queued = this.queue.find((r) => r.run_id === runId);
    if (queued) {
      return queued;
    }

    return null;
  }

  /**
   * Get queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.queue.length === 0 && this.runningRun === null;
  }

  /**
   * Check if a run is currently executing
   */
  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Get the currently running run
   */
  getCurrentRun(): QueuedRun | null {
    return this.runningRun;
  }

  /**
   * Process the queue (execute runs serially)
   */
  async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const run = this.dequeue();
        if (!run) {
          break;
        }

        await this.executeRun(run);
      }

      this.emit('queue.empty', null);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Execute a single run with timeout
   */
  private async executeRun(run: QueuedRun): Promise<void> {
    // Update status to running
    const runningRun: QueuedRun = {
      ...run,
      status: 'running',
    };
    this.runningRun = runningRun;
    this.emit('run.started', runningRun);
    logger.info('Run started', { runId: run.run_id });

    try {
      if (this.executor) {
        // Execute with timeout
        await Promise.race([
          this.executor(runningRun),
          this.createTimeout(run.run_id),
        ]);
      }

      // Mark as completed
      const completedRun: QueuedRun = {
        ...runningRun,
        status: 'completed',
      };
      this.completedRuns.set(run.run_id, completedRun);
      this.emit('run.completed', completedRun);
      logger.info('Run completed', { runId: run.run_id });
    } catch (error) {
      // Mark as failed
      const failedRun: QueuedRun = {
        ...runningRun,
        status: 'failed',
      };
      this.completedRuns.set(run.run_id, failedRun);
      this.emit('run.failed', failedRun);
      logger.error('Run failed', {
        runId: run.run_id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.runningRun = null;
    }
  }

  /**
   * Create a timeout promise
   */
  private createTimeout(runId: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Run ${runId} timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);
    });
  }

  /**
   * Clear completed runs from memory
   */
  clearCompleted(): void {
    this.completedRuns.clear();
  }

  /**
   * Cancel a pending run (remove from queue)
   */
  cancel(runId: string): boolean {
    const index = this.queue.findIndex((r) => r.run_id === runId);
    if (index === -1) {
      return false;
    }

    this.queue.splice(index, 1);
    logger.info('Run cancelled', { runId });
    return true;
  }

  /**
   * Get all pending runs
   */
  getPendingRuns(): QueuedRun[] {
    return [...this.queue];
  }

  /**
   * Get all completed runs
   */
  getCompletedRuns(): QueuedRun[] {
    return Array.from(this.completedRuns.values());
  }
}
