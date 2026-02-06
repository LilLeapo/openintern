/**
 * Agent Executor - Integrates AgentLoop with RunQueue
 *
 * Features:
 * - Creates and executes AgentLoop for queued runs
 * - Broadcasts events via SSE
 * - Updates projections after run completion
 */

import type { QueuedRun } from '../../types/api.js';
import type { Event } from '../../types/events.js';
import { AgentLoop } from '../agent/agent-loop.js';
import { ProjectionStore } from '../store/projection-store.js';
import { SSEManager } from '../api/sse.js';
import { logger } from '../../utils/logger.js';

/**
 * Agent executor configuration
 */
export interface AgentExecutorConfig {
  baseDir: string;
  sseManager: SSEManager;
  maxSteps?: number;
}

/**
 * Create an agent executor function for the RunQueue
 */
export function createAgentExecutor(config: AgentExecutorConfig): (run: QueuedRun) => Promise<void> {
  const { baseDir, sseManager, maxSteps = 10 } = config;

  return async (run: QueuedRun): Promise<void> => {
    logger.info('Agent executor starting', {
      runId: run.run_id,
      sessionKey: run.session_key,
    });

    // Create AgentLoop
    const agentLoop = new AgentLoop(
      run.run_id,
      run.session_key,
      { maxSteps },
      baseDir
    );

    // Set up event callback for SSE broadcasting
    agentLoop.setEventCallback((event: Event) => {
      sseManager.broadcastToRun(run.run_id, event);
    });

    try {
      // Execute the agent loop
      await agentLoop.execute(run.input);

      // Update projections after completion
      const projectionStore = new ProjectionStore(
        run.session_key,
        run.run_id,
        baseDir
      );
      await projectionStore.generateRunMeta();

      logger.info('Agent executor completed', {
        runId: run.run_id,
        status: agentLoop.getStatus().status,
      });
    } catch (error) {
      logger.error('Agent executor failed', {
        runId: run.run_id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}
