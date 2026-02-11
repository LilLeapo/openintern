import type { QueuedRun } from '../../types/api.js';
import type { LLMConfig } from '../../types/agent.js';
import type { Event } from '../../types/events.js';
import { SSEManager } from '../api/sse.js';
import { logger } from '../../utils/logger.js';
import { SingleAgentRunner } from './agent-runner.js';
import { CheckpointService } from './checkpoint-service.js';
import { EpisodicGenerator } from './episodic-generator.js';
import { EventService } from './event-service.js';
import { GroupRepository } from './group-repository.js';
import { MemoryService } from './memory-service.js';
import { SerialOrchestrator, type OrchestratorMember } from './orchestrator.js';
import { RoleRepository } from './role-repository.js';
import { RoleRunnerFactory } from './role-runner-factory.js';
import { RunRepository } from './run-repository.js';
import { SkillRegistry } from './skill-registry.js';
import { SkillRepository } from './skill-repository.js';
import { RuntimeToolRouter } from './tool-router.js';

type Scope = { orgId: string; userId: string; projectId: string | null };
type RunTerminalStatus = 'completed' | 'failed' | 'cancelled';

const TOKEN_EVENT_BATCH_SIZE = 24;
const BUILTIN_TOOL_RISK_LEVELS: Record<string, 'low' | 'medium' | 'high'> = {
  memory_search: 'low',
  memory_get: 'low',
  memory_write: 'medium',
  read_file: 'low',
  export_trace: 'low',
  skills_list: 'low',
  skills_get: 'low',
};

export interface RuntimeExecutorConfig {
  runRepository: RunRepository;
  eventService: EventService;
  checkpointService: CheckpointService;
  memoryService: MemoryService;
  skillRepository: SkillRepository;
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

function isCancellationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const e = error as { name?: string; message?: string };
  if (e.name === 'AbortError' || e.name === 'RunCancelledError') {
    return true;
  }
  const message = (e.message ?? '').toLowerCase();
  return message.includes('aborted') || message.includes('cancelled');
}

export function createRuntimeExecutor(
  config: RuntimeExecutorConfig
): (run: QueuedRun, signal: AbortSignal) => Promise<{ status: RunTerminalStatus }> {
  let sharedToolRouter: RuntimeToolRouter | null = null;
  let sharedToolRouterInit: Promise<RuntimeToolRouter> | null = null;

  async function refreshSkillRegistry(router: RuntimeToolRouter): Promise<void> {
    const availableTools = router.listTools().map((tool) => tool.name);
    const registry = new SkillRegistry();

    const builtinToolNames = availableTools.filter((name) =>
      Object.prototype.hasOwnProperty.call(BUILTIN_TOOL_RISK_LEVELS, name)
    );
    registry.registerBuiltinTools(builtinToolNames, BUILTIN_TOOL_RISK_LEVELS);

    try {
      const persistedSkills = await config.skillRepository.list();
      for (const skill of persistedSkills) {
        registry.register(skill);
      }
    } catch (error) {
      logger.error('Failed to load persisted skills for runtime registry', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Ensure all available tools are represented in the skill catalog.
    const unresolvedTools = availableTools.filter(
      (toolName) => registry.getToolMeta(toolName) === null
    );
    if (unresolvedTools.length > 0) {
      const unresolvedBuiltin = unresolvedTools.filter((toolName) => !toolName.includes('.'));
      const unresolvedMcp = unresolvedTools.filter((toolName) => toolName.includes('.'));

      if (unresolvedBuiltin.length > 0) {
        registry.register({
          id: 'runtime_builtin_auto',
          name: 'Runtime Builtin (auto)',
          description: 'Automatically discovered builtin tools.',
          tools: unresolvedBuiltin.map((name) => ({
            name,
            description: '',
            parameters: {},
          })),
          risk_level: 'low',
          provider: 'builtin',
          health_status: 'healthy',
        });
      }

      if (unresolvedMcp.length > 0) {
        registry.register({
          id: 'runtime_mcp_auto',
          name: 'Runtime MCP (auto)',
          description: 'Automatically discovered MCP tools.',
          tools: unresolvedMcp.map((name) => ({
            name,
            description: '',
            parameters: {},
          })),
          risk_level: 'low',
          provider: 'mcp',
          health_status: 'healthy',
        });
      }
    }

    router.setSkillRegistry(registry);
  }

  async function getSharedToolRouter(scope: Scope): Promise<RuntimeToolRouter> {
    if (sharedToolRouter) {
      sharedToolRouter.setScope(scope);
      await refreshSkillRegistry(sharedToolRouter);
      return sharedToolRouter;
    }
    if (!sharedToolRouterInit) {
      sharedToolRouterInit = (async () => {
        const router = new RuntimeToolRouter({
          scope,
          memoryService: config.memoryService,
          eventService: config.eventService,
          workDir: config.workDir,
          ...(config.mcp ? { mcp: config.mcp } : {}),
        });
        await router.start();
        sharedToolRouter = router;
        return router;
      })().catch((error) => {
        sharedToolRouterInit = null;
        throw error;
      });
    }

    const router = await sharedToolRouterInit;
    router.setScope(scope);
    await refreshSkillRegistry(router);
    return router;
  }

  return async (run: QueuedRun, signal: AbortSignal): Promise<{ status: RunTerminalStatus }> => {
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

    if (signal.aborted) {
      await config.runRepository.setRunCancelled(run.run_id);
      return { status: 'cancelled' };
    }

    const toolRouter = await getSharedToolRouter(scope);

    await config.runRepository.setRunRunning(run.run_id);

    try {
      let status: RunTerminalStatus;

      if (run.group_id) {
        status = await executeGroupRun(config, run, scope, modelConfig, toolRouter, signal);
      } else {
        status = await executeSingleRun(config, run, scope, modelConfig, toolRouter, signal);
      }

      return { status };
    } catch (error: unknown) {
      if (signal.aborted || isCancellationError(error)) {
        await config.runRepository.setRunCancelled(run.run_id);
        logger.info('Runtime executor cancelled', { runId: run.run_id });
        return { status: 'cancelled' };
      }

      const message = error instanceof Error ? error.message : String(error);
      await config.runRepository.setRunFailed(run.run_id, {
        code: 'EXECUTOR_ERROR',
        message,
      });
      logger.error('Runtime executor failed', {
        runId: run.run_id,
        error: message,
      });
      return { status: 'failed' };
    }
  };
}

// ─── Single agent run ────────────────────────────────────────

async function executeSingleRun(
  config: RuntimeExecutorConfig,
  run: QueuedRun,
  scope: Scope,
  modelConfig: LLMConfig,
  toolRouter: RuntimeToolRouter,
  signal: AbortSignal
): Promise<RunTerminalStatus> {
  const runner = new SingleAgentRunner({
    maxSteps: config.maxSteps,
    modelConfig,
    checkpointService: config.checkpointService,
    memoryService: config.memoryService,
    toolRouter,
  });

  const status = await consumeEventStream(
    config,
    run.run_id,
    runner.run(run.input, {
      runId: run.run_id,
      sessionKey: run.session_key,
      scope,
      agentId: run.agent_id,
      abortSignal: signal,
    }),
    signal
  );
  return status ?? (signal.aborted ? 'cancelled' : 'completed');
}

// ─── Group run (serial orchestration) ────────────────────────

async function executeGroupRun(
  config: RuntimeExecutorConfig,
  run: QueuedRun,
  scope: Scope,
  modelConfig: LLMConfig,
  toolRouter: RuntimeToolRouter,
  signal: AbortSignal
): Promise<RunTerminalStatus> {
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

  const status = await consumeEventStream(
    config,
    run.run_id,
    orchestrator.run(run.input, {
      runId: run.run_id,
      sessionKey: run.session_key,
      scope,
      abortSignal: signal,
    }),
    signal,
    groupId,
    scope
  );
  return status ?? (signal.aborted ? 'cancelled' : 'completed');
}

// ─── Shared event processing ─────────────────────────────────

async function consumeEventStream(
  config: RuntimeExecutorConfig,
  runId: string,
  stream: AsyncGenerator<Event, unknown, void>,
  signal: AbortSignal,
  groupId?: string,
  scope?: Scope
): Promise<RunTerminalStatus | null> {
  let tokenBuffer: Event[] = [];
  let terminalStatus: RunTerminalStatus | null = null;

  const flushTokens = async (): Promise<void> => {
    if (tokenBuffer.length === 0) {
      return;
    }
    await config.eventService.writeBatch(tokenBuffer);
    tokenBuffer = [];
  };

  for await (const event of stream) {
    if (event.type === 'llm.token') {
      config.sseManager.broadcastToRun(runId, event);
      tokenBuffer.push(event);
      if (tokenBuffer.length >= TOKEN_EVENT_BATCH_SIZE) {
        await flushTokens();
      }
      continue;
    }

    await flushTokens();
    const status = await processEvent(config, runId, event, groupId, scope);
    if (status) {
      terminalStatus = status;
    }
    if (signal.aborted && terminalStatus === null) {
      terminalStatus = 'cancelled';
    }
  }

  await flushTokens();
  return terminalStatus;
}

async function processEvent(
  config: RuntimeExecutorConfig,
  runId: string,
  event: Event,
  groupId?: string,
  scope?: Scope
): Promise<RunTerminalStatus | null> {
  await config.eventService.write(event);
  config.sseManager.broadcastToRun(runId, event);

  if (event.type === 'run.completed') {
    await config.runRepository.setRunCompleted(runId, event.payload.output);

    // Auto-generate episodic memories for group runs
    if (groupId && scope) {
      try {
        const generator = new EpisodicGenerator(
          config.memoryService,
          config.eventService
        );
        await generator.generateFromRun(runId, groupId, scope);
      } catch (err) {
        logger.error('Failed to generate episodic memories', {
          runId,
          groupId,
          error: String(err),
        });
      }
    }
    return 'completed';
  } else if (event.type === 'run.failed') {
    if (event.payload.error.code === 'RUN_CANCELLED') {
      await config.runRepository.setRunCancelled(runId);
      return 'cancelled';
    }
    await config.runRepository.setRunFailed(runId, {
      code: event.payload.error.code,
      message: event.payload.error.message,
    });
    return 'failed';
  }
  return null;
}
