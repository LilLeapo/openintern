import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { RuntimeToolRouter } from './tool-router.js';
import type { MemoryService } from './memory-service.js';
import type { EventService } from './event-service.js';
import type { FeishuSyncService } from './feishu-sync-service.js';
import type { AgentContext } from './tool-policy.js';
import { SkillRegistry } from './skill-registry.js';

interface MockMemoryService {
  memory_search: Mock;
  memory_get: Mock;
  memory_write: Mock;
}

interface MockEventService {
  list: Mock;
}

interface MockFeishuSyncService {
  ingestDoc: Mock;
}

describe('RuntimeToolRouter', () => {
  let workDir: string;
  let memoryService: MockMemoryService;
  let eventService: MockEventService;
  let feishuSyncService: MockFeishuSyncService;

  beforeEach(async () => {
    workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'runtime-tool-router-'));
    memoryService = {
      memory_search: vi.fn().mockResolvedValue([
        {
          id: 'mem_1',
          snippet: 'snippet',
          score: 0.8,
          type: 'episodic',
        },
      ]),
      memory_get: vi.fn().mockResolvedValue({
        id: 'mem_1',
        type: 'episodic',
        text: 'memory text',
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      memory_write: vi.fn().mockResolvedValue({ id: 'mem_1' }),
    };
    eventService = {
      list: vi.fn().mockResolvedValue({
        events: [],
        next_cursor: null,
      }),
    };
    feishuSyncService = {
      ingestDoc: vi.fn().mockResolvedValue({
        memory_id: '11111111-1111-1111-1111-111111111111',
        source_key: 'docx:RJMNwnAHIiVsYzkzhsYcilM0nxd',
        document_id: 'RJMNwnAHIiVsYzkzhsYcilM0nxd',
        revision_id: '42',
        title: 'Doc',
        chunk_count: 3,
        content_hash: 'hash',
        replaced: 1,
      }),
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.promises.rm(workDir, { recursive: true, force: true });
  });

  function createRouter(
    timeoutMs = 50,
    options: { withFeishu?: boolean } = {}
  ): RuntimeToolRouter {
    return new RuntimeToolRouter({
      scope: {
        orgId: 'org_test',
        userId: 'user_test',
        projectId: null,
      },
      memoryService: memoryService as unknown as MemoryService,
      eventService: eventService as unknown as EventService,
      ...(options.withFeishu === false
        ? {}
        : { feishuSyncService: feishuSyncService as unknown as FeishuSyncService }),
      workDir,
      timeoutMs,
    });
  }

  it('returns builtin tools list', () => {
    const router = createRouter();
    const names = router.listTools().map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'memory_search',
        'memory_get',
        'memory_write',
        'feishu_ingest_doc',
        'read_file',
        'export_trace',
        'skills_list',
        'skills_get',
      ])
    );
  });

  it('validates required params for memory_search', async () => {
    const router = createRouter();
    const result = await router.callTool('memory_search', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('query is required');
    expect(memoryService.memory_search).not.toHaveBeenCalled();
  });

  it('validates memory_write type and required fields', async () => {
    const router = createRouter();

    const missing = await router.callTool('memory_write', {
      type: 'episodic',
    });
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('type and text are required');

    const invalid = await router.callTool('memory_write', {
      type: 'unknown',
      text: 'hello',
    });
    expect(invalid.success).toBe(false);
    expect(invalid.error).toContain('invalid memory type');
    expect(memoryService.memory_write).not.toHaveBeenCalled();
  });

  it('validates required params for feishu_ingest_doc', async () => {
    const router = createRouter();
    const result = await router.callTool('feishu_ingest_doc', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('doc_token or doc_url is required');
    expect(feishuSyncService.ingestDoc).not.toHaveBeenCalled();
  });

  it('calls feishu_ingest_doc with mapped scope and payload', async () => {
    const router = createRouter();
    const result = await router.callTool('feishu_ingest_doc', {
      doc_url: 'https://example.feishu.cn/wiki/RJMNwnAHIiVsYzkzhsYcilM0nxd',
      project_shared: false,
      chunking: { target_tokens: 480 },
      metadata: { group: 'group1' },
    });

    expect(result.success).toBe(true);
    expect(feishuSyncService.ingestDoc).toHaveBeenCalledWith({
      scope: {
        orgId: 'org_test',
        userId: 'user_test',
        projectId: null,
      },
      doc_url: 'https://example.feishu.cn/wiki/RJMNwnAHIiVsYzkzhsYcilM0nxd',
      project_shared: false,
      chunking: { target_tokens: 480 },
      metadata: { group: 'group1' },
    });
  });

  it('returns explicit error when feishu service is not configured', async () => {
    const router = createRouter(50, { withFeishu: false });
    const result = await router.callTool('feishu_ingest_doc', {
      doc_token: 'RJMNwnAHIiVsYzkzhsYcilM0nxd',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('feishu sync service is not configured');
  });

  it('rejects invalid path escape for read_file', async () => {
    const router = createRouter();
    const result = await router.callTool('read_file', {
      path: '../outside.txt',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Path escapes working directory');
  });

  it('calls memory_search with normalized scope and params', async () => {
    const router = createRouter();
    const result = await router.callTool('memory_search', {
      query: 'hello',
      top_k: 3,
      filters: { type: 'episodic' },
    });

    expect(result.success).toBe(true);
    expect(memoryService.memory_search).toHaveBeenCalledWith({
      query: 'hello',
      scope: {
        org_id: 'org_test',
        user_id: 'user_test',
      },
      top_k: 3,
      filters: { type: 'episodic' },
    });
  });

  it('returns error result instead of throwing when tool handler fails', async () => {
    eventService.list.mockRejectedValueOnce(new Error('db jitter'));
    const router = createRouter();

    const result = await router.callTool('export_trace', {
      run_id: 'run_test123456',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('db jitter');
  });

  it('returns timeout error when tool execution exceeds timeout', async () => {
    const readSpy = vi
      .spyOn(fs.promises, 'readFile')
      .mockImplementation(
        async () =>
          await new Promise<string>(() => {
            // intentionally never resolves
          })
      );
    const router = createRouter(20);

    const result = await router.callTool('read_file', {
      path: 'README.md',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    readSpy.mockRestore();
  });

  it('returns not-found error for unknown tools', async () => {
    const router = createRouter();
    const result = await router.callTool('unknown.tool', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Tool not found');
  });

  it('returns skills catalog from skills_list tool', async () => {
    const registry = new SkillRegistry();
    registry.register({
      id: 'skill_fs',
      name: 'File Skill',
      description: 'file operations',
      tools: [{ name: 'read_file', description: 'read file', parameters: {} }],
      risk_level: 'low',
      provider: 'builtin',
      health_status: 'healthy',
    });
    const router = new RuntimeToolRouter({
      scope: {
        orgId: 'org_test',
        userId: 'user_test',
        projectId: null,
      },
      memoryService: memoryService as unknown as MemoryService,
      eventService: eventService as unknown as EventService,
      workDir,
      timeoutMs: 50,
      skillRegistry: registry,
    });

    const result = await router.callTool('skills_list', {});

    expect(result.success).toBe(true);
    const payload = result.result as {
      count: number;
      skills: Array<{ id: string; tools?: string[] }>;
    };
    expect(payload.count).toBe(1);
    expect(payload.skills[0]?.id).toBe('skill_fs');
    expect(payload.skills[0]?.tools).toEqual(['read_file']);
  });

  it('returns one skill from skills_get tool', async () => {
    const registry = new SkillRegistry();
    registry.register({
      id: 'skill_mem',
      name: 'Memory Skill',
      description: 'memory ops',
      tools: [{ name: 'memory_search', description: 'search', parameters: {} }],
      risk_level: 'low',
      provider: 'builtin',
      health_status: 'healthy',
    });
    const router = new RuntimeToolRouter({
      scope: {
        orgId: 'org_test',
        userId: 'user_test',
        projectId: null,
      },
      memoryService: memoryService as unknown as MemoryService,
      eventService: eventService as unknown as EventService,
      workDir,
      timeoutMs: 50,
      skillRegistry: registry,
    });

    const result = await router.callTool('skills_get', { skill_id: 'skill_mem' });

    expect(result.success).toBe(true);
    const payload = result.result as { id: string; tools: Array<{ name: string }> };
    expect(payload.id).toBe('skill_mem');
    expect(payload.tools[0]?.name).toBe('memory_search');
  });

  describe('policy checks', () => {
    function createRouterWithRegistry(timeoutMs = 50): RuntimeToolRouter {
      const registry = new SkillRegistry();
      registry.registerBuiltinTools(
        [
          'memory_search',
          'memory_get',
          'memory_write',
          'feishu_ingest_doc',
          'read_file',
          'export_trace',
          'skills_list',
          'skills_get',
        ],
        {
          memory_search: 'low',
          memory_get: 'low',
          memory_write: 'medium',
          feishu_ingest_doc: 'medium',
          read_file: 'low',
          export_trace: 'low',
          skills_list: 'low',
          skills_get: 'low',
        }
      );
      return new RuntimeToolRouter({
        scope: {
          orgId: 'org_test',
          userId: 'user_test',
          projectId: null,
        },
        memoryService: memoryService as unknown as MemoryService,
        eventService: eventService as unknown as EventService,
        workDir,
        timeoutMs,
        skillRegistry: registry,
      });
    }

    const allowedAgent: AgentContext = {
      agentId: 'agent_1',
      roleId: 'role_1',
      allowedTools: [],
      deniedTools: [],
    };

    const deniedAgent: AgentContext = {
      agentId: 'agent_2',
      roleId: 'role_2',
      allowedTools: [],
      deniedTools: ['memory_search'],
    };

    const whitelistAgent: AgentContext = {
      agentId: 'agent_3',
      roleId: 'role_3',
      allowedTools: ['read_file'],
      deniedTools: [],
    };

    it('skips policy check when no agentContext is provided (backward compat)', async () => {
      const router = createRouterWithRegistry();
      const result = await router.callTool('memory_search', {
        query: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.blocked).toBeUndefined();
    });

    it('allows tool call when agent has no restrictions', async () => {
      const router = createRouterWithRegistry();
      const result = await router.callTool('memory_search', {
        query: 'test',
      }, allowedAgent);

      expect(result.success).toBe(true);
      expect(result.blocked).toBeUndefined();
    });

    it('blocks tool call when tool is in deniedTools', async () => {
      const router = createRouterWithRegistry();
      const result = await router.callTool('memory_search', {
        query: 'test',
      }, deniedAgent);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.error).toContain('Blocked');
    });

    it('blocks tool not in allowedTools whitelist', async () => {
      const router = createRouterWithRegistry();
      const result = await router.callTool('memory_search', {
        query: 'test',
      }, whitelistAgent);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.error).toContain('Blocked');
    });

    it('allows tool in allowedTools whitelist', async () => {
      const router = createRouterWithRegistry();
      await fs.promises.writeFile(path.join(workDir, 'test.txt'), 'hello');
      const result = await router.callTool('read_file', {
        path: 'test.txt',
      }, whitelistAgent);

      expect(result.success).toBe(true);
      expect(result.blocked).toBeUndefined();
    });

    it('uses skillRegistry risk level for policy decisions', async () => {
      const registry = new SkillRegistry();
      registry.registerBuiltinTools(
        [
          'memory_search',
          'memory_get',
          'memory_write',
          'feishu_ingest_doc',
          'read_file',
          'export_trace',
          'skills_list',
          'skills_get',
        ],
        { memory_write: 'high' }
      );
      const router = new RuntimeToolRouter({
        scope: { orgId: 'org_test', userId: 'user_test', projectId: null },
        memoryService: memoryService as unknown as MemoryService,
        eventService: eventService as unknown as EventService,
        workDir,
        timeoutMs: 50,
        skillRegistry: registry,
      });

      // Agent with no explicit allow/deny — high risk tool should be blocked by default
      const result = await router.callTool('memory_write', {
        type: 'episodic',
        text: 'test',
      }, allowedAgent);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.error).toContain('high risk');
    });

    it('matches whitelist by skill id', async () => {
      const registry = new SkillRegistry();
      registry.register({
        id: 'skill_fs',
        name: 'File',
        description: '',
        tools: [{ name: 'read_file', description: '', parameters: {} }],
        risk_level: 'low',
        provider: 'builtin',
        health_status: 'healthy',
      });
      const router = new RuntimeToolRouter({
        scope: { orgId: 'org_test', userId: 'user_test', projectId: null },
        memoryService: memoryService as unknown as MemoryService,
        eventService: eventService as unknown as EventService,
        workDir,
        timeoutMs: 50,
        skillRegistry: registry,
      });
      await fs.promises.writeFile(path.join(workDir, 'test.txt'), 'hello');
      const result = await router.callTool(
        'read_file',
        { path: 'test.txt' },
        {
          agentId: 'agent_skill',
          roleId: 'role_skill',
          allowedTools: ['skill:skill_fs'],
          deniedTools: [],
        }
      );
      expect(result.success).toBe(true);
    });
  });
});
