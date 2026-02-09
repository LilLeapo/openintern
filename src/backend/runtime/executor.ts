import type { QueuedRun } from '../../types/api.js';
import type { LLMConfig } from '../../types/agent.js';
import { SSEManager } from '../api/sse.js';
import { logger } from '../../utils/logger.js';
import { SingleAgentRunner } from './agent-runner.js';
import { CheckpointService } from './checkpoint-service.js';
import { EventService } from './event-service.js';
import { MemoryService } from './memory-service.js';
import { RunRepository } from './run-repository.js';
import { RuntimeToolRouter } from './tool-router.js';

export interface RuntimeExecutorConfig {
  runRepository: RunRepository;
  eventService: EventService;
  checkpointService: CheckpointService;
  memoryService: MemoryService;
  sseManager: SSEManager;
  maxSteps: number;
  defaultModelConfig: LLMConfig;
  workDir: string;
  mcp?: {
    enabled: boolean;
    pythonPath?: string;
    serverModule?: string;
    cwd?: string;
    timeoutMs?: number;
  };
}

export function createRuntimeExecutor(config: RuntimeExecutorConfig): (run: QueuedRun) => Promise<void> {
  return async (run: QueuedRun): Promise<void> => {
    const scope = {
      orgId: run.org_id,
      userId: run.user_id,
      projectId: run.project_id ?? null,
    };

    const modelConfig: LLMConfig = {
      provider: run.llm_config?.provider ?? config.defaultModelConfig.provider,
      model: run.llm_config?.model ?? config.defaultModelConfig.model,
    };
    const temperature = run.llm_config?.temperature ?? config.defaultModelConfig.temperature;
    if (temperature !== undefined) {
      modelConfig.temperature = temperature;
    }
    const maxTokens = run.llm_config?.max_tokens ?? config.defaultModelConfig.maxTokens;
    if (maxTokens !== undefined) {
      modelConfig.maxTokens = maxTokens;
    }

    const toolRouterConfig = {
      scope,
      memoryService: config.memoryService,
      eventService: config.eventService,
      workDir: config.workDir,
      ...(config.mcp ? { mcp: config.mcp } : {}),
    };
    const toolRouter = new RuntimeToolRouter(toolRouterConfig);

    await config.runRepository.setRunRunning(run.run_id);

    const runner = new SingleAgentRunner({
      maxSteps: config.maxSteps,
      modelConfig,
      checkpointService: config.checkpointService,
      memoryService: config.memoryService,
      toolRouter,
    });

    try {
      await toolRouter.start();
      for await (const event of runner.run(run.input, {
        runId: run.run_id,
        sessionKey: run.session_key,
        scope,
        agentId: run.agent_id,
      })) {
        await config.eventService.write(event);
        config.sseManager.broadcastToRun(run.run_id, event);

        if (event.type === 'run.completed') {
          await config.runRepository.setRunCompleted(run.run_id, event.payload.output);
        } else if (event.type === 'run.failed') {
          await config.runRepository.setRunFailed(run.run_id, {
            code: event.payload.error.code,
            message: event.payload.error.message,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await config.runRepository.setRunFailed(run.run_id, {
        code: 'EXECUTOR_ERROR',
        message,
      });
      logger.error('Runtime executor failed', {
        runId: run.run_id,
        error: message,
      });
      throw error;
    } finally {
      await toolRouter.stop();
    }
  };
}
