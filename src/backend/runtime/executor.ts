import type { QueuedRun } from '../../types/api.js';
import type { LLMConfig } from '../../types/agent.js';
import { SSEManager } from '../api/sse.js';
import { logger } from '../../utils/logger.js';
import { SingleAgentRunner } from './agent-runner.js';
import { CheckpointService } from './checkpoint-service.js';
import { EventService } from './event-service.js';
import { GroupRepository } from './group-repository.js';
import { MemoryService } from './memory-service.js';
import { SerialOrchestrator, type OrchestratorMember } from './orchestrator.js';
import { RoleRepository } from './role-repository.js';
import { RoleRunnerFactory } from './role-runner-factory.js';
import { RunRepository } from './run-repository.js';
import { RuntimeToolRouter } from './tool-router.js';

export interface RuntimeExecutorConfig {
  runRepository: RunRepository;
  eventService: EventService;
  checkpointService: CheckpointService;
  memoryService: MemoryService;
  sseManager: SSEManager;
  groupRepository: GroupRepository;
  roleRepository: RoleRepository;
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

    try {
      await toolRouter.start();

      if (run.group_id) {
        await executeGroupRun(config, run, scope, modelConfig, toolRouter);
      } else {
        await executeSingleRun(config, run, scope, modelConfig, toolRouter);
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

// ─── Single agent run ────────────────────────────────────────

async function executeSingleRun(
  config: RuntimeExecutorConfig,
  run: QueuedRun,
  scope: { orgId: string; userId: string; projectId: string | null },
  modelConfig: LLMConfig,
  toolRouter: RuntimeToolRouter
): Promise<void> {
  const runner = new SingleAgentRunner({
    maxSteps: config.maxSteps,
    modelConfig,
    checkpointService: config.checkpointService,
    memoryService: config.memoryService,
    toolRouter,
  });

  for await (const event of runner.run(run.input, {
    runId: run.run_id,
    sessionKey: run.session_key,
    scope,
    agentId: run.agent_id,
  })) {
    await processEvent(config, run.run_id, event);
  }
}

// ─── Group run (serial orchestration) ────────────────────────

async function executeGroupRun(
  config: RuntimeExecutorConfig,
  run: QueuedRun,
  scope: { orgId: string; userId: string; projectId: string | null },
  modelConfig: LLMConfig,
  toolRouter: RuntimeToolRouter
): Promise<void> {
  const groupId = run.group_id!;
  const members = await config.groupRepository.listMembers(groupId);

  if (members.length === 0) {
    throw new Error(`Group ${groupId} has no members`);
  }

  // Resolve roles for each member
  const orchMembers: OrchestratorMember[] = [];
  for (const member of members) {
    const role = await config.roleRepository.getById(member.role_id);
    if (!role) {
      throw new Error(`Role ${member.role_id} not found for member ${member.id}`);
    }
    orchMembers.push({
      role,
      agentInstanceId: member.agent_instance_id ?? member.id,
    });
  }

  const factory = new RoleRunnerFactory({
    maxSteps: config.maxSteps,
    modelConfig,
    checkpointService: config.checkpointService,
    memoryService: config.memoryService,
    toolRouter,
  });

  const orchestrator = new SerialOrchestrator({
    groupId,
    members: orchMembers,
    maxRounds: 3,
    runnerFactory: factory,
  });

  for await (const event of orchestrator.run(run.input, {
    runId: run.run_id,
    sessionKey: run.session_key,
    scope,
  })) {
    await processEvent(config, run.run_id, event);
  }
}

// ─── Shared event processing ─────────────────────────────────

async function processEvent(
  config: RuntimeExecutorConfig,
  runId: string,
  event: import('../../types/events.js').Event
): Promise<void> {
  await config.eventService.write(event);
  config.sseManager.broadcastToRun(runId, event);

  if (event.type === 'run.completed') {
    await config.runRepository.setRunCompleted(runId, event.payload.output);
  } else if (event.type === 'run.failed') {
    await config.runRepository.setRunFailed(runId, {
      code: event.payload.error.code,
      message: event.payload.error.message,
    });
  }
}
