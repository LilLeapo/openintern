import { describe, expect, it } from 'vitest';
import { ToolPolicy } from './tool-policy.js';
import type { AgentContext, ToolMeta } from './tool-policy.js';

describe('ToolPolicy', () => {
  const policy = new ToolPolicy();

  function makeAgent(overrides: Partial<AgentContext> = {}): AgentContext {
    return {
      agentId: 'agent_1',
      roleId: 'role_1',
      allowedTools: [],
      deniedTools: [],
      ...overrides,
    };
  }

  function makeTool(overrides: Partial<ToolMeta> = {}): ToolMeta {
    return {
      name: 'read_file',
      riskLevel: 'low',
      source: 'builtin',
      ...overrides,
    };
  }

  describe('default policy (no allowed/denied)', () => {
    it('allows low risk tools', () => {
      const result = policy.check(makeAgent(), makeTool({ riskLevel: 'low' }));
      expect(result.allowed).toBe(true);
    });

    it('allows medium risk tools', () => {
      const result = policy.check(makeAgent(), makeTool({ riskLevel: 'medium' }));
      expect(result.allowed).toBe(true);
    });

    it('blocks high risk tools', () => {
      const result = policy.check(makeAgent(), makeTool({ riskLevel: 'high' }));
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('high risk');
    });
  });

  describe('denied_tools (blacklist)', () => {
    it('blocks explicitly denied tool regardless of risk level', () => {
      const agent = makeAgent({ deniedTools: ['read_file'] });
      const tool = makeTool({ name: 'read_file', riskLevel: 'low' });
      const result = policy.check(agent, tool);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('explicitly denied');
    });

    it('allows tools not in denied list', () => {
      const agent = makeAgent({ deniedTools: ['memory_write'] });
      const tool = makeTool({ name: 'read_file', riskLevel: 'low' });
      const result = policy.check(agent, tool);
      expect(result.allowed).toBe(true);
    });
  });

  describe('allowed_tools (whitelist)', () => {
    it('allows tool in whitelist', () => {
      const agent = makeAgent({ allowedTools: ['read_file', 'memory_search'] });
      const tool = makeTool({ name: 'read_file' });
      const result = policy.check(agent, tool);
      expect(result.allowed).toBe(true);
    });

    it('blocks tool not in whitelist', () => {
      const agent = makeAgent({ allowedTools: ['memory_search'] });
      const tool = makeTool({ name: 'read_file' });
      const result = policy.check(agent, tool);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in the allowed list');
    });

    it('allows high risk tool if explicitly whitelisted', () => {
      const agent = makeAgent({ allowedTools: ['dangerous_tool'] });
      const tool = makeTool({ name: 'dangerous_tool', riskLevel: 'high' });
      const result = policy.check(agent, tool);
      expect(result.allowed).toBe(true);
    });
  });

  describe('priority: denied > allowed > risk_level', () => {
    it('denied takes precedence over allowed', () => {
      const agent = makeAgent({
        allowedTools: ['read_file'],
        deniedTools: ['read_file'],
      });
      const tool = makeTool({ name: 'read_file' });
      const result = policy.check(agent, tool);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('explicitly denied');
    });
  });

  describe('contextFromRole', () => {
    it('builds AgentContext from Role', () => {
      const role = {
        id: 'role_critic',
        name: 'Critic',
        system_prompt: 'You are a critic',
        allowed_tools: ['memory_search'],
        denied_tools: ['memory_write'],
        style_constraints: {},
        is_lead: false,
        description: '',
      };
      const ctx = ToolPolicy.contextFromRole(role, 'agent_42');
      expect(ctx.agentId).toBe('agent_42');
      expect(ctx.roleId).toBe('role_critic');
      expect(ctx.allowedTools).toEqual(['memory_search']);
      expect(ctx.deniedTools).toEqual(['memory_write']);
    });
  });
});
