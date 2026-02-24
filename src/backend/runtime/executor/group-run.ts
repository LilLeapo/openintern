import type { QueuedRun } from '../../../types/api.js';
import type { LLMConfig } from '../../../types/agent.js';
import type { RuntimeExecutorConfig } from '../executor.js';
import type { RuntimeToolRouter } from '../tool-router.js';
import type { ToolCallScheduler } from '../tool-scheduler.js';
import type { SkillLoader } from '../skill/loader.js';
import { SerialOrchestrator, type OrchestratorMember } from '../orchestrator.js';
import { RoleRunnerFactory } from '../role-runner-factory.js';
import { consumeEventStream } from './event-consumer.js';

type Scope = { orgId: string; userId: string; projectId: string | null };
type RunTerminalStatus = 'completed' | 'failed' | 'cancelled' | 'suspended';

export async function executeGroupRun(
  config: RuntimeExecutorConfig,
  run: QueuedRun,
  scope: Scope,
  modelConfig: LLMConfig,
  toolRouter: RuntimeToolRouter,
  signal: AbortSignal,
  extras?: {
    toolScheduler?: ToolCallScheduler;
    skillLoader?: SkillLoader;
  }
): Promise<RunTerminalStatus> {
  const groupId = run.group_id!;
  const members = await config.groupRepository.listMembers(groupId);
  if (members.length === 0) {
    throw new Error(`Group ${groupId} has no members`);
  }

  const runRecord = await config.runRepository.getRunById(run.run_id);
  const delegatedPermissions = runRecord?.delegatedPermissions ?? undefined;

  const orchMembers: OrchestratorMember[] = [];
  for (const member of members) {
    const role = await config.roleRepository.getById(member.role_id);
    if (!role) throw new Error(`Role ${member.role_id} not found for member ${member.id}`);
    orchMembers.push({
      role,
      agentInstanceId: member.agent_instance_id ?? member.id,
    });
  }

  // Build skill injections
  const skillInjections: { skillId: string; name: string; content: string }[] = [];
  if (extras?.skillLoader && config.enableImplicitSkills) {
    for (const skill of extras.skillLoader.listImplicitSkills()) {
      const content = await extras.skillLoader.loadSkillContent(skill.id);
      if (content) skillInjections.push({ skillId: skill.id, name: skill.name, content });
    }
  }

  const factory = new RoleRunnerFactory({
    maxSteps: config.maxSteps,
    modelConfig,
    checkpointService: config.checkpointService,
    memoryService: config.memoryService,
    toolRouter,
    ...(extras?.toolScheduler ? { toolScheduler: extras.toolScheduler } : {}),
    ...(skillInjections.length > 0 ? { skillInjections } : {}),
    workDir: config.workDir,
    ...(config.budget ? { budget: config.budget } : {}),
    ...(delegatedPermissions ? { delegatedPermissions } : {}),
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
