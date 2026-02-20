import type { RuntimeTool, ToolContext } from '../_helpers.js';
import { extractString } from '../_helpers.js';
import { ToolError } from '../../../../utils/errors.js';

export function register(ctx: ToolContext): RuntimeTool[] {
  return [
    {
      name: 'escalate_to_group',
      description:
        'Escalate a complex task to a specialized group of agents. Use this when the task requires expertise or capabilities beyond your own.',
      parameters: {
        type: 'object',
        properties: {
          group_id: { type: 'string', description: 'Optional. The ID of the group to escalate to.' },
          goal: { type: 'string', description: 'Clear description of what the group should accomplish' },
          context: { type: 'string', description: 'Relevant context from the current conversation' },
        },
        required: ['goal'],
      },
      source: 'builtin',
      metadata: { risk_level: 'medium', mutating: true, supports_parallel: false },
      handler: async (params) => {
        const escalationService = ctx.escalationService;
        if (!escalationService) {
          throw new ToolError('Escalation service is not configured', 'escalate_to_group');
        }
        if (!ctx.currentRunId || !ctx.currentSessionKey) {
          throw new ToolError('Run context is not set; cannot escalate outside of a run', 'escalate_to_group');
        }
        const groupId = extractString(params['group_id']);
        const goal = extractString(params['goal']);
        const context = extractString(params['context']);
        if (!goal) throw new ToolError('goal is required', 'escalate_to_group');

        return escalationService.escalate({
          parentRunId: ctx.currentRunId,
          scope: ctx.scope,
          sessionKey: ctx.currentSessionKey,
          goal,
          ...(groupId ? { groupId } : {}),
          ...(context ? { context } : {}),
          ...(ctx.currentAgentContext?.delegatedPermissions
            ? { delegatedPermissions: ctx.currentAgentContext.delegatedPermissions }
            : {}),
        });
      },
    },
    {
      name: 'list_available_groups',
      description: 'List all available groups that can be escalated to, along with their capabilities.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Optional. Filter groups by project.' },
        },
      },
      source: 'builtin',
      metadata: { risk_level: 'low', mutating: false, supports_parallel: true },
      handler: async (params) => {
        const groupRepository = ctx.groupRepository;
        if (!groupRepository) {
          throw new ToolError('Group repository is not configured', 'list_available_groups');
        }
        const projectId = extractString(params['project_id']) ?? ctx.scope.projectId ?? undefined;
        const groups = await groupRepository.listGroupsWithRoles(projectId);
        return {
          groups: groups.map((g) => ({
            id: g.id,
            name: g.name,
            description: g.description,
            members: g.members.map((m) => ({
              role: m.role_name,
              description: m.role_description,
            })),
          })),
        };
      },
    },
  ];
}
