/**
 * Agent Executor - Integrates AgentLoop with RunQueue
 *
 * Features:
 * - Creates and executes AgentLoop for queued runs
 * - Broadcasts events via SSE
 * - Updates projections after run completion
 */

import type { QueuedRun } from '../../types/api.js';
import type { LLMConfig, AgentLoopConfig } from '../../types/agent.js';
import type { EmbeddingConfig } from '../../types/embedding.js';
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
  defaultModelConfig?: LLMConfig;
  /** Custom working directory for file tools */
  workDir?: string;
  /** Whether to attempt resuming from checkpoint */
  resume?: boolean;
  /** Embedding configuration for hybrid search */
  embedding?: EmbeddingConfig;
}

/**
 * Create an agent executor function for the RunQueue
 */
export function createAgentExecutor(config: AgentExecutorConfig): (run: QueuedRun) => Promise<void> {
  const { baseDir, sseManager, maxSteps = 10, defaultModelConfig, workDir, resume: shouldResume, embedding } = config;

  return async (run: QueuedRun): Promise<void> => {
    logger.info('Agent executor starting', {
      runId: run.run_id,
      sessionKey: run.session_key,
    });

    // Build modelConfig: request-level llm_config overrides server-level default
    const loopConfig: Partial<AgentLoopConfig> = { maxSteps };
    if (workDir) {
      loopConfig.workDir = workDir;
    }
    if (embedding) {
      loopConfig.embedding = embedding;
    }

    if (run.llm_config) {
      const mc: LLMConfig = {
        provider: run.llm_config.provider ?? defaultModelConfig?.provider ?? 'mock',
        model: run.llm_config.model ?? defaultModelConfig?.model ?? 'mock-model',
      };
      if (run.llm_config.base_url) {
        mc.baseUrl = run.llm_config.base_url;
      } else if (
        run.llm_config.provider === undefined
        || run.llm_config.provider === defaultModelConfig?.provider
      ) {
        if (defaultModelConfig?.baseUrl) {
          mc.baseUrl = defaultModelConfig.baseUrl;
        }
      }
      const temp = run.llm_config.temperature ?? defaultModelConfig?.temperature;
      if (temp !== undefined) mc.temperature = temp;
      const maxTok = run.llm_config.max_tokens ?? defaultModelConfig?.maxTokens;
      if (maxTok !== undefined) mc.maxTokens = maxTok;
      loopConfig.modelConfig = mc;
    } else if (defaultModelConfig) {
      loopConfig.modelConfig = defaultModelConfig;
    }

    // Create AgentLoop
    const agentLoop = new AgentLoop(
      run.run_id,
      run.session_key,
      loopConfig,
      baseDir
    );

    // Set up event callback for SSE broadcasting
    agentLoop.setEventCallback((event: Event) => {
      sseManager.broadcastToRun(run.run_id, event);
    });

    try {
      // Execute or resume the agent loop
      if (shouldResume) {
        try {
          await agentLoop.resume();
        } catch {
          logger.info('Resume failed, starting fresh', { runId: run.run_id });
          await agentLoop.execute(run.input);
        }
      } else {
        await agentLoop.execute(run.input);
      }

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
