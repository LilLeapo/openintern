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
}

/**
 * ToolPolicy evaluates whether a given agent/role is permitted
 * to invoke a specific tool.
 *
 * Priority: denied_tools (blacklist) > allowed_tools (whitelist) > risk-level default.
 */
export class ToolPolicy {
  /**
   * Check if an agent is allowed to call a tool.
   */
  check(agent: AgentContext, tool: ToolMeta): PolicyCheckResult {
    // 1. Blacklist takes highest priority
    if (agent.deniedTools.length > 0 && agent.deniedTools.includes(tool.name)) {
      return {
        allowed: false,
        reason: `Tool "${tool.name}" is explicitly denied for role "${agent.roleId}"`,
      };
    }

    // 2. Whitelist: if specified, only listed tools are allowed
    if (agent.allowedTools.length > 0) {
      if (agent.allowedTools.includes(tool.name)) {
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
