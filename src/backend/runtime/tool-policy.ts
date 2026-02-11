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
 * Result of a policy check.
 */
export interface PolicyCheckResult {
  allowed: boolean;
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

  private matchesPolicyEntry(entry: string, tool: ToolMeta): boolean {
    if (entry === tool.name) {
      return true;
    }
    if (!tool.skillId) {
      return false;
    }
    return entry === tool.skillId || entry === `skill:${tool.skillId}`;
  }

  /**
   * Check if an agent is allowed to call a tool.
   */
  check(agent: AgentContext, tool: ToolMeta): PolicyCheckResult {
    // Skills discovery is safe and should always remain available.
    if (ToolPolicy.ALWAYS_ALLOWED_TOOLS.has(tool.name)) {
      return { allowed: true, reason: 'Tool is always allowed' };
    }

    // 1. Blacklist takes highest priority
    if (
      agent.deniedTools.length > 0 &&
      agent.deniedTools.some((entry) => this.matchesPolicyEntry(entry, tool))
    ) {
      const identifier = tool.skillId ?? tool.name;
      return {
        allowed: false,
        reason: `Tool "${tool.name}" (skill "${identifier}") is explicitly denied for role "${agent.roleId}"`,
      };
    }

    // 2. Whitelist: if specified, only listed tools are allowed
    if (agent.allowedTools.length > 0) {
      if (agent.allowedTools.some((entry) => this.matchesPolicyEntry(entry, tool))) {
        return { allowed: true, reason: 'Tool is in allowed list' };
      }
      return {
        allowed: false,
        reason: `Tool "${tool.name}" is not in the allowed list for role "${agent.roleId}"`,
      };
    }

    // 3. Default: allow low/medium, block high
    if (tool.riskLevel === 'high') {
      return {
        allowed: false,
        reason: `Tool "${tool.name}" has high risk level and no explicit allow for role "${agent.roleId}"`,
      };
    }

    return { allowed: true, reason: 'Default policy: low/medium risk allowed' };
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
