import type { Role } from '../../types/orchestrator.js';
import type { RiskLevel } from '../../types/skill.js';

/**
 * Agent context passed to ToolRouter for policy checks.
 */
export interface AgentContext {
  agentId: string;
  roleId: string;
  allowedTools: string[];
  deniedTools: string[];
}

/**
 * Three-state policy decision: allow, deny, or ask (requires approval).
 */
export type PolicyDecision = 'allow' | 'deny' | 'ask';

/**
 * Result of a policy check.
 */
export interface PolicyCheckResult {
  allowed: boolean;
  decision: PolicyDecision;
  reason: string;
}

/**
 * Tool metadata used for policy decisions.
 */
export interface ToolMeta {
  name: string;
  riskLevel: RiskLevel;
  source: 'builtin' | 'mcp';
  skillId?: string;
}

/**
 * ToolPolicy evaluates whether a given agent/role is permitted
 * to invoke a specific tool.
 *
 * Priority: denied_tools (blacklist) > allowed_tools (whitelist) > risk-level default.
 */
export class ToolPolicy {
  private static readonly ALWAYS_ALLOWED_TOOLS = new Set<string>([
    'skills_list',
    'skills_get',
  ]);

  /**
   * Match a policy entry against a tool, supporting glob patterns.
   * Patterns: exact match, skill:id, wildcard suffix (e.g. mcp__github__*)
   */
  private matchesPolicyEntry(entry: string, tool: ToolMeta): boolean {
    // Exact tool name match
    if (entry === tool.name) return true;

    // Glob-style wildcard suffix: "mcp__github__*" matches "mcp__github__create_issue"
    if (entry.endsWith('*')) {
      const prefix = entry.slice(0, -1);
      if (tool.name.startsWith(prefix)) return true;
      if (tool.skillId?.startsWith(prefix)) return true;
    }

    // Skill-level match
    if (tool.skillId) {
      if (entry === tool.skillId || entry === `skill:${tool.skillId}`) return true;
    }

    return false;
  }

  /**
   * Check if an agent is allowed to call a tool.
   * Returns three-state decision: allow, deny, or ask.
   */
  check(agent: AgentContext, tool: ToolMeta): PolicyCheckResult {
    // Skills discovery is safe and should always remain available.
    if (ToolPolicy.ALWAYS_ALLOWED_TOOLS.has(tool.name)) {
      return { allowed: true, decision: 'allow', reason: 'Tool is always allowed' };
    }

    // 1. Blacklist takes highest priority
    if (
      agent.deniedTools.length > 0 &&
      agent.deniedTools.some((entry) => this.matchesPolicyEntry(entry, tool))
    ) {
      const identifier = tool.skillId ?? tool.name;
      return {
        allowed: false,
        decision: 'deny',
        reason: `Tool "${tool.name}" (skill "${identifier}") is explicitly denied for role "${agent.roleId}"`,
      };
    }

    // 2. Whitelist: if specified, only listed tools are allowed
    if (agent.allowedTools.length > 0) {
      if (agent.allowedTools.some((entry) => this.matchesPolicyEntry(entry, tool))) {
        return { allowed: true, decision: 'allow', reason: 'Tool is in allowed list' };
      }
      return {
        allowed: false,
        decision: 'deny',
        reason: `Tool "${tool.name}" is not in the allowed list for role "${agent.roleId}"`,
      };
    }

    // 3. High risk tools require approval instead of outright deny
    if (tool.riskLevel === 'high') {
      return {
        allowed: false,
        decision: 'ask',
        reason: `Tool "${tool.name}" has high risk level — requires approval for role "${agent.roleId}"`,
      };
    }

    return { allowed: true, decision: 'allow', reason: 'Default policy: low/medium risk allowed' };
  }

  /**
   * Check whether a tool requires explicit human approval.
   */
  needsApproval(agent: AgentContext, tool: ToolMeta): boolean {
    const result = this.check(agent, tool);
    return result.decision === 'ask';
  }

  /**
   * Evaluate policy for a batch of tools. Returns per-tool decisions.
   */
  evaluateBatchPolicy(
    agent: AgentContext,
    tools: ToolMeta[]
  ): PolicyCheckResult[] {
    return tools.map((tool) => this.check(agent, tool));
  }

  /**
   * Build AgentContext from a Role definition.
   */
  static contextFromRole(role: Role, agentId: string): AgentContext {
    return {
      agentId,
      roleId: role.id,
      allowedTools: role.allowed_tools,
      deniedTools: role.denied_tools,
    };
  }
}
