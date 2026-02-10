import type { LLMConfig } from '../../types/agent.js';
import type { Role } from '../../types/orchestrator.js';
import { SingleAgentRunner, type AgentRunner, type SingleAgentRunnerConfig } from './agent-runner.js';
import { CheckpointService } from './checkpoint-service.js';
import { MemoryService } from './memory-service.js';
import { RuntimeToolRouter } from './tool-router.js';
import { ToolPolicy } from './tool-policy.js';

export interface RoleRunnerFactoryConfig {
  maxSteps: number;
  modelConfig: LLMConfig;
  checkpointService: CheckpointService;
  memoryService: MemoryService;
  toolRouter: RuntimeToolRouter;
}

/**
 * Factory that creates AgentRunner instances from Role definitions.
 * Each role gets its own system prompt injected into the runner.
 */
export class RoleRunnerFactory {
  constructor(private readonly config: RoleRunnerFactoryConfig) {}

  create(role: Role, agentId?: string): AgentRunner {
    const systemPrompt = this.buildRolePrompt(role);
    const agentContext = ToolPolicy.contextFromRole(
      role,
      agentId ?? role.id
    );

    const runnerConfig: SingleAgentRunnerConfig = {
      maxSteps: this.config.maxSteps,
      modelConfig: this.config.modelConfig,
      checkpointService: this.config.checkpointService,
      memoryService: this.config.memoryService,
      toolRouter: this.config.toolRouter,
      systemPrompt,
      agentContext,
    };

    return new SingleAgentRunner(runnerConfig);
  }

  private buildRolePrompt(role: Role): string {
    const lines: string[] = [role.system_prompt];

    if (role.is_lead) {
      lines.push('');
      lines.push('You are the LEAD of this group. Your responsibilities:');
      lines.push('- Synthesize proposals and evidence from other agents');
      lines.push('- Make final DECISION with rationale');
      lines.push('- Coordinate next actions');
    }

    lines.push('');
    lines.push('Communication protocol:');
    lines.push('- Structure your output with a clear message_type');
    lines.push('- Use PROPOSAL to suggest plans');
    lines.push('- Use EVIDENCE to provide supporting data');
    lines.push('- Use STATUS to report progress');
    if (role.is_lead) {
      lines.push('- Use DECISION to make final calls');
    }

    return lines.join('\n');
  }
}