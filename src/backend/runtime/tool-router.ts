import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../../types/agent.js';
import type { Skill } from '../../types/skill.js';
import type { ScopeContext } from './scope.js';
import { ToolError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { MCPClient } from '../agent/mcp-client.js';
import type { EventService } from './event-service.js';
import type { MemoryService } from './memory-service.js';
import type { AgentContext } from './tool-policy.js';
import { ToolPolicy } from './tool-policy.js';
import type { SkillRegistry } from './skill-registry.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

interface RuntimeTool extends ToolDefinition {
  handler: ToolHandler;
  source: 'builtin' | 'mcp';
}

interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const MCP_RETRYABLE_ERROR_MARKERS = [
  'MCP server closed',
  'MCP Client not started',
  'Request timeout:',
  'EPIPE',
  'ERR_STREAM_DESTROYED',
  'stream is not writable',
  'Cannot call write after a stream was destroyed',
];

function extractString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

interface McpToolPayload {
  isError?: boolean;
  content?: unknown;
  structuredContent?: unknown;
  error?: { message?: string };
}

function parseFirstTextContent(result: unknown): unknown {
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  const value = result as { content?: Array<{ type?: string; text?: string }> };
  const first = value.content?.[0];
  if (!first || first.type !== 'text' || !first.text) {
    return undefined;
  }
  try {
    return JSON.parse(first.text) as unknown;
  } catch {
    return first.text;
  }
}

function parseMcpContent(result: unknown): unknown {
  if (!result || typeof result !== 'object') {
    return result;
  }

  const payload = result as McpToolPayload;
  const parsedText = parseFirstTextContent(result);
  const hasStructured = 'structuredContent' in payload;
  const hasIsError = payload.isError === true;

  // Keep the full envelope when tool reports isError to preserve context.
  if (hasIsError) {
    return {
      isError: true,
      ...(hasStructured ? { structuredContent: payload.structuredContent } : {}),
      ...(parsedText !== undefined ? { content: parsedText } : {}),
    };
  }

  // Prefer structured content when available.
  if (hasStructured) {
    return payload.structuredContent;
  }

  if (parsedText !== undefined) {
    return parsedText;
  }

  return result;
}

function isMcpErrorPayload(value: unknown): value is McpToolPayload & { isError: true } {
  return Boolean(value && typeof value === 'object' && (value as McpToolPayload).isError === true);
}

function extractMcpErrorMessage(value: McpToolPayload & { isError: true }): string {
  const directError = value.error?.message;
  if (typeof directError === 'string' && directError.trim()) {
    return directError.trim();
  }

  const structured = value.structuredContent;
  if (structured && typeof structured === 'object') {
    const message = (structured as { message?: unknown })['message'];
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }

  const content = value.content;
  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }
  if (content && typeof content === 'object') {
    const message = (content as { message?: unknown })['message'];
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }

  return 'MCP tool returned isError=true';
}

function resolveWithinWorkDir(workDir: string, requestedPath: string): string {
  const absoluteWorkDir = path.resolve(workDir);
  const resolvedPath = path.resolve(absoluteWorkDir, requestedPath);
  if (!resolvedPath.startsWith(`${absoluteWorkDir}${path.sep}`) && resolvedPath !== absoluteWorkDir) {
    throw new ToolError('Path escapes working directory', 'read_file');
  }
  return resolvedPath;
}

export interface RuntimeToolRouterConfig {
  scope: ScopeContext;
  memoryService: MemoryService;
  eventService: EventService;
  workDir: string;
  mcp?: {
    enabled: boolean;
    pythonPath?: string;
    serverModule?: string;
    cwd?: string;
    timeoutMs?: number;
  };
  timeoutMs?: number;
  skillRegistry?: SkillRegistry;
}

const DEFAULT_TIMEOUT_MS = 30000;

export class RuntimeToolRouter {
  private readonly tools = new Map<string, RuntimeTool>();
  private readonly timeoutMs: number;
  private readonly mcpClient: MCPClient | null;
  private readonly toolPolicy: ToolPolicy;
  private skillRegistry: SkillRegistry | null;
  private scope: ScopeContext;

  constructor(private readonly config: RuntimeToolRouterConfig) {
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.scope = config.scope;
    this.toolPolicy = new ToolPolicy();
    this.skillRegistry = config.skillRegistry ?? null;
    this.mcpClient = config.mcp?.enabled
      ? new MCPClient({
          ...(config.mcp.pythonPath ? { pythonPath: config.mcp.pythonPath } : {}),
          ...(config.mcp.serverModule ? { serverModule: config.mcp.serverModule } : {}),
          ...(config.mcp.cwd ? { cwd: config.mcp.cwd } : {}),
          timeout: config.mcp.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        })
      : null;
    this.registerBuiltinTools();
  }

  setScope(scope: ScopeContext): void {
    this.scope = scope;
  }

  setSkillRegistry(skillRegistry: SkillRegistry | null): void {
    this.skillRegistry = skillRegistry;
  }

  async start(): Promise<void> {
    if (!this.mcpClient) {
      return;
    }
    await this.mcpClient.start();
    await this.refreshMcpTools();
  }

  async stop(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.stop();
    }
  }

  listTools(): ToolDefinition[] {
    return [...this.tools.values()].map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }

  listSkills(): Skill[] {
    return this.skillRegistry?.listSkills() ?? [];
  }

  async callTool(
    name: string,
    params: Record<string, unknown>,
    agentContext?: AgentContext
  ): Promise<ToolResult> {
    const started = Date.now();
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${name}`,
        duration: Date.now() - started,
      };
    }

    // Policy check when agent context is provided
    if (agentContext) {
      const policyResult = this.checkPolicy(name, tool, agentContext);
      if (!policyResult.allowed) {
        logger.warn('Tool call blocked by policy', {
          tool: name,
          agentId: agentContext.agentId,
          roleId: agentContext.roleId,
          reason: policyResult.reason,
        });
        return {
          success: false,
          error: `Blocked: ${policyResult.reason}`,
          duration: Date.now() - started,
          blocked: true,
        };
      }
    }

    try {
      const result = await Promise.race([
        tool.handler(params),
        this.timeout(name),
      ]);
      if (tool.source === 'mcp' && isMcpErrorPayload(result)) {
        return {
          success: false,
          result,
          error: extractMcpErrorMessage(result),
          duration: Date.now() - started,
        };
      }
      return {
        success: true,
        result,
        duration: Date.now() - started,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
        duration: Date.now() - started,
      };
    }
  }

  private checkPolicy(
    toolName: string,
    tool: RuntimeTool,
    agent: AgentContext
  ): { allowed: boolean; reason: string } {
    const toolMeta = this.skillRegistry?.getToolMeta(toolName) ?? {
      name: toolName,
      riskLevel: 'low' as const,
      source: tool.source,
    };
    return this.toolPolicy.check(agent, toolMeta);
  }

  private getSkillOrThrow(skillId: string): Skill {
    const skill = this.skillRegistry?.getSkill(skillId);
    if (!skill) {
      throw new ToolError(`Skill not found: ${skillId}`, 'skills_get');
    }
    return skill;
  }

  private registerBuiltinTools(): void {
    this.tools.set('memory_search', {
      name: 'memory_search',
      description: 'Hybrid memory retrieval by vector + full-text search',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          top_k: { type: 'number', default: 8 },
          filters: { type: 'object' },
        },
        required: ['query'],
      },
      source: 'builtin',
      handler: async (params) => {
        const query = extractString(params['query']);
        if (!query) {
          throw new ToolError('query is required', 'memory_search');
        }
        const topKRaw = params['top_k'];
        const topK =
          typeof topKRaw === 'number' && Number.isFinite(topKRaw)
            ? Math.floor(topKRaw)
            : 8;
        const filters = params['filters'];
        const searchInput = {
          query,
          scope: {
            org_id: this.scope.orgId,
            user_id: this.scope.userId,
            ...(this.scope.projectId ? { project_id: this.scope.projectId } : {}),
          },
          top_k: topK,
          ...(typeof filters === 'object' && filters !== null
            ? { filters: filters as Record<string, unknown> }
            : {}),
        };
        return this.config.memoryService.memory_search(searchInput);
      },
    });

    this.tools.set('memory_get', {
      name: 'memory_get',
      description: 'Read full memory by id',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
      source: 'builtin',
      handler: async (params) => {
        const id = extractString(params['id']);
        if (!id) {
          throw new ToolError('id is required', 'memory_get');
        }
        return this.config.memoryService.memory_get(id, {
          org_id: this.scope.orgId,
          user_id: this.scope.userId,
          ...(this.scope.projectId ? { project_id: this.scope.projectId } : {}),
        });
      },
    });

    this.tools.set('memory_write', {
      name: 'memory_write',
      description: 'Persist a memory entry and its chunk embeddings',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['core', 'episodic', 'archival'] },
          text: { type: 'string' },
          metadata: { type: 'object' },
          importance: { type: 'number' },
        },
        required: ['type', 'text'],
      },
      source: 'builtin',
      handler: async (params) => {
        const type = extractString(params['type']);
        const text = extractString(params['text']);
        if (!type || !text) {
          throw new ToolError('type and text are required', 'memory_write');
        }
        if (!['core', 'episodic', 'archival'].includes(type)) {
          throw new ToolError('invalid memory type', 'memory_write');
        }
        const metadata = params['metadata'];
        const importance = params['importance'];
        return this.config.memoryService.memory_write({
          type: type as 'core' | 'episodic' | 'archival',
          scope: {
            org_id: this.scope.orgId,
            user_id: this.scope.userId,
            ...(this.scope.projectId ? { project_id: this.scope.projectId } : {}),
          },
          text,
          metadata: typeof metadata === 'object' && metadata !== null
            ? (metadata as Record<string, unknown>)
            : undefined,
          importance: typeof importance === 'number' ? importance : undefined,
        });
      },
    });

    this.tools.set('read_file', {
      name: 'read_file',
      description: 'Read a UTF-8 file from the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
      source: 'builtin',
      handler: async (params) => {
        const filePath = extractString(params['path']);
        if (!filePath) {
          throw new ToolError('path is required', 'read_file');
        }
        const resolved = resolveWithinWorkDir(this.config.workDir, filePath);
        const content = await fs.promises.readFile(resolved, 'utf-8');
        return { path: filePath, content };
      },
    });

    this.tools.set('export_trace', {
      name: 'export_trace',
      description: 'Export run events trace as JSON payload',
      parameters: {
        type: 'object',
        properties: {
          run_id: { type: 'string' },
          limit: { type: 'number', default: 2000 },
        },
        required: ['run_id'],
      },
      source: 'builtin',
      handler: async (params) => {
        const runId = extractString(params['run_id']);
        if (!runId) {
          throw new ToolError('run_id is required', 'export_trace');
        }
        const limitRaw = params['limit'];
        const limit =
          typeof limitRaw === 'number' && Number.isFinite(limitRaw) ? Math.max(1, Math.floor(limitRaw)) : 2000;
        const page = await this.config.eventService.list(runId, this.scope, undefined, limit);
        return {
          run_id: runId,
          next_cursor: page.next_cursor,
          events: page.events,
        };
      },
    });

    this.tools.set('skills_list', {
      name: 'skills_list',
      description: 'List available skills and their tools',
      parameters: {
        type: 'object',
        properties: {
          include_tools: { type: 'boolean', default: true },
          provider: { type: 'string', enum: ['builtin', 'mcp'] },
          risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
      source: 'builtin',
      handler: async (params) => {
        const includeTools = params['include_tools'] !== false;
        const provider = extractString(params['provider']);
        const riskLevel = extractString(params['risk_level']);

        let skills = this.skillRegistry?.listSkills() ?? [];
        if (provider) {
          skills = skills.filter((skill) => skill.provider === provider);
        }
        if (riskLevel) {
          skills = skills.filter((skill) => skill.risk_level === riskLevel);
        }

        return {
          count: skills.length,
          skills: skills.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            risk_level: skill.risk_level,
            provider: skill.provider,
            health_status: skill.health_status,
            ...(includeTools
              ? { tools: skill.tools.map((tool) => tool.name) }
              : {}),
          })),
        };
      },
    });

    this.tools.set('skills_get', {
      name: 'skills_get',
      description: 'Get full details for one skill by id',
      parameters: {
        type: 'object',
        properties: {
          skill_id: { type: 'string' },
        },
        required: ['skill_id'],
      },
      source: 'builtin',
      handler: async (params) => {
        const skillId = extractString(params['skill_id']);
        if (!skillId) {
          throw new ToolError('skill_id is required', 'skills_get');
        }
        const skill = this.getSkillOrThrow(skillId);
        return {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          provider: skill.provider,
          risk_level: skill.risk_level,
          health_status: skill.health_status,
          tools: skill.tools,
        };
      },
    });
  }

  private timeout(toolName: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new ToolError(`Tool timed out after ${this.timeoutMs}ms`, toolName));
      }, this.timeoutMs);
    });
  }

  private async callMcpTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.mcpClient) {
      throw new ToolError('MCP client is not enabled', name);
    }
    try {
      const result = await this.mcpClient.callTool(name, params);
      return parseMcpContent(result);
    } catch (error) {
      if (!this.isRecoverableMcpError(error)) {
        throw error;
      }
      logger.warn('MCP call failed, retrying after reconnect', {
        toolName: name,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.reconnectMcpClient();
      const result = await this.mcpClient.callTool(name, params);
      return parseMcpContent(result);
    }
  }

  private async reconnectMcpClient(): Promise<void> {
    if (!this.mcpClient) {
      throw new Error('MCP client is not enabled');
    }

    await this.mcpClient.stop().catch(() => undefined);
    await this.mcpClient.start();
    await this.refreshMcpTools();
  }

  private async refreshMcpTools(): Promise<void> {
    if (!this.mcpClient) {
      return;
    }
    const tools = (await this.mcpClient.listTools()) as MCPToolDefinition[];
    const seen = new Set<string>();
    for (const tool of tools) {
      seen.add(tool.name);
      this.tools.set(tool.name, {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        source: 'mcp',
        handler: async (params) => this.callMcpTool(tool.name, params),
      });
    }
    for (const [name, tool] of this.tools.entries()) {
      if (tool.source === 'mcp' && !seen.has(name)) {
        this.tools.delete(name);
      }
    }
    logger.info('MCP tools registered', { count: tools.length });
  }

  private isRecoverableMcpError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return MCP_RETRYABLE_ERROR_MARKERS.some((marker) => message.includes(marker));
  }
}
