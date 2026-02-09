import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult } from '../../types/agent.js';
import type { ScopeContext } from './scope.js';
import { ToolError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { MCPClient } from '../agent/mcp-client.js';
import type { EventService } from './event-service.js';
import type { MemoryService } from './memory-service.js';

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

function extractString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseMcpContent(result: unknown): unknown {
  if (!result || typeof result !== 'object') {
    return result;
  }
  const value = result as { content?: Array<{ type?: string; text?: string }> };
  const first = value.content?.[0];
  if (!first || first.type !== 'text' || !first.text) {
    return result;
  }
  try {
    return JSON.parse(first.text) as unknown;
  } catch {
    return first.text;
  }
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
}

const DEFAULT_TIMEOUT_MS = 30000;

export class RuntimeToolRouter {
  private readonly tools = new Map<string, RuntimeTool>();
  private readonly timeoutMs: number;
  private readonly mcpClient: MCPClient | null;

  constructor(private readonly config: RuntimeToolRouterConfig) {
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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

  async start(): Promise<void> {
    if (!this.mcpClient) {
      return;
    }
    await this.mcpClient.start();
    const tools = await this.mcpClient.listTools() as MCPToolDefinition[];
    for (const tool of tools) {
      if (!this.tools.has(tool.name)) {
        this.tools.set(tool.name, {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          source: 'mcp',
          handler: async (params) => this.callMcpTool(tool.name, params),
        });
      }
    }
    logger.info('MCP tools registered', { count: tools.length });
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

  async callTool(name: string, params: Record<string, unknown>): Promise<ToolResult> {
    const started = Date.now();
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${name}`,
        duration: Date.now() - started,
      };
    }

    try {
      const result = await Promise.race([
        tool.handler(params),
        this.timeout(name),
      ]);
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
            org_id: this.config.scope.orgId,
            user_id: this.config.scope.userId,
            ...(this.config.scope.projectId ? { project_id: this.config.scope.projectId } : {}),
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
          org_id: this.config.scope.orgId,
          user_id: this.config.scope.userId,
          ...(this.config.scope.projectId ? { project_id: this.config.scope.projectId } : {}),
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
            org_id: this.config.scope.orgId,
            user_id: this.config.scope.userId,
            ...(this.config.scope.projectId ? { project_id: this.config.scope.projectId } : {}),
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
        const page = await this.config.eventService.list(runId, this.config.scope, undefined, limit);
        return {
          run_id: runId,
          next_cursor: page.next_cursor,
          events: page.events,
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
    const result = await this.mcpClient.callTool(name, params);
    return parseMcpContent(result);
  }
}
