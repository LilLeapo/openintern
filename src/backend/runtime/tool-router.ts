import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { ToolDefinition, ToolResult } from '../../types/agent.js';
import type { Skill } from '../../types/skill.js';
import type { FeishuChunkingConfig } from '../../types/feishu.js';
import type { MineruExtractOptions } from '../../types/mineru.js';
import type { ScopeContext } from './scope.js';
import { ToolError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { MCPClient } from '../agent/mcp-client.js';
import type { EventService } from './event-service.js';
import type { FeishuSyncService } from './feishu-sync-service.js';
import type { MineruIngestService } from './mineru-ingest-service.js';
import type { MemoryService } from './memory-service.js';
import type { AgentContext } from './tool-policy.js';
import { ToolPolicy } from './tool-policy.js';
import type { SkillRegistry } from './skill-registry.js';
import type { EscalationService } from './escalation-service.js';
import type { GroupRepository } from './group-repository.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

interface RuntimeTool extends ToolDefinition {
  handler: ToolHandler;
  source: 'builtin' | 'mcp';
  metadata?: ToolDefinition['metadata'];
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

function extractBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
}

function extractNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
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
  feishuSyncService?: FeishuSyncService;
  mineruIngestService?: MineruIngestService;
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
  /** Escalation service for PA -> Group delegation */
  escalationService?: EscalationService;
  /** Group repository for listing available groups */
  groupRepository?: GroupRepository;
  /** Current run ID (needed for escalation tool) */
  currentRunId?: string;
  /** Current session key (needed for escalation tool) */
  currentSessionKey?: string;
}

const DEFAULT_TIMEOUT_MS = 30000;

export class RuntimeToolRouter {
  private readonly tools = new Map<string, RuntimeTool>();
  private readonly timeoutMs: number;
  private readonly mcpClient: MCPClient | null;
  private readonly toolPolicy: ToolPolicy;
  private skillRegistry: SkillRegistry | null;
  private scope: ScopeContext;
  private currentRunId: string | null;
  private currentSessionKey: string | null;
  /** Current agent context, used by escalation handler to pass delegated permissions */
  private currentAgentContext: AgentContext | null;

  constructor(private readonly config: RuntimeToolRouterConfig) {
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.scope = config.scope;
    this.toolPolicy = new ToolPolicy();
    this.skillRegistry = config.skillRegistry ?? null;
    this.currentRunId = config.currentRunId ?? null;
    this.currentSessionKey = config.currentSessionKey ?? null;
    this.currentAgentContext = null;
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

  setRunContext(runId: string, sessionKey: string): void {
    this.currentRunId = runId;
    this.currentSessionKey = sessionKey;
  }

  setAgentContext(agentContext: AgentContext | null): void {
    this.currentAgentContext = agentContext;
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
    return [...this.tools.values()].map(({ name, description, parameters, metadata }) => ({
      name,
      description,
      parameters,
      ...(metadata
        ? {
            metadata: {
              risk_level: metadata.risk_level ?? 'low',
              mutating: metadata.mutating ?? false,
              supports_parallel: metadata.supports_parallel ?? true,
              ...(metadata.timeout_ms !== undefined ? { timeout_ms: metadata.timeout_ms } : {}),
            },
          }
        : {}),
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
        // Distinguish 'ask' (requires approval) from 'deny' (blocked)
        if (policyResult.decision === 'ask') {
          logger.info('Tool call requires approval', {
            tool: name,
            agentId: agentContext.agentId,
            roleId: agentContext.roleId,
            reason: policyResult.reason,
          });
          return {
            success: false,
            error: `Requires approval: ${policyResult.reason}`,
            duration: Date.now() - started,
            requiresApproval: true,
            policyReason: policyResult.reason,
            riskLevel: this.getToolRiskLevel(name, tool),
          };
        }
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
  ): { allowed: boolean; decision: import('./tool-policy.js').PolicyDecision; reason: string } {
    const toolMeta = this.skillRegistry?.getToolMeta(toolName) ?? {
      name: toolName,
      riskLevel: 'low' as const,
      source: tool.source,
    };
    // Use delegated-aware check when agent has delegated permissions
    if (agent.delegatedPermissions) {
      return this.toolPolicy.checkWithDelegated(agent, toolMeta);
    }
    return this.toolPolicy.check(agent, toolMeta);
  }

  private getToolRiskLevel(toolName: string, tool: RuntimeTool): string {
    const toolMeta = this.skillRegistry?.getToolMeta(toolName);
    if (toolMeta) return toolMeta.riskLevel;
    return tool.metadata?.risk_level ?? 'low';
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

    this.tools.set('feishu_ingest_doc', {
      name: 'feishu_ingest_doc',
      description: 'Ingest one Feishu document into archival knowledge memory',
      parameters: {
        type: 'object',
        properties: {
          doc_token: { type: 'string', description: 'Feishu doc token (or wiki token)' },
          doc_url: { type: 'string', description: 'Feishu document URL; token will be parsed from path' },
          title: { type: 'string', description: 'Optional title override' },
          source_key: { type: 'string', description: 'Optional stable source key, default: docx:<document_id>' },
          chunking: {
            type: 'object',
            properties: {
              target_tokens: { type: 'number' },
              max_tokens: { type: 'number' },
              min_tokens: { type: 'number' },
              media_context_blocks: { type: 'number' },
            },
          },
          project_shared: { type: 'boolean', default: true },
          metadata: { type: 'object' },
        },
      },
      source: 'builtin',
      metadata: { risk_level: 'medium', mutating: true, supports_parallel: false },
      handler: async (params) => {
        const service = this.config.feishuSyncService;
        if (!service) {
          throw new ToolError('feishu sync service is not configured', 'feishu_ingest_doc');
        }
        const docToken = extractString(params['doc_token']);
        const docUrl = extractString(params['doc_url']);
        if (!docToken && !docUrl) {
          throw new ToolError('doc_token or doc_url is required', 'feishu_ingest_doc');
        }
        const title = extractString(params['title']);
        const sourceKey = extractString(params['source_key']);

        const chunkingRaw = params['chunking'];
        const chunking =
          typeof chunkingRaw === 'object' && chunkingRaw !== null
            ? (chunkingRaw as Partial<FeishuChunkingConfig>)
            : undefined;
        const metadataRaw = params['metadata'];
        const metadata =
          typeof metadataRaw === 'object' && metadataRaw !== null
            ? (metadataRaw as Record<string, unknown>)
            : undefined;
        const projectShared = extractBoolean(params['project_shared']);

        return service.ingestDoc({
          scope: {
            orgId: this.scope.orgId,
            userId: this.scope.userId,
            projectId: this.scope.projectId,
          },
          ...(docToken ? { doc_token: docToken } : {}),
          ...(docUrl ? { doc_url: docUrl } : {}),
          ...(title ? { title } : {}),
          ...(sourceKey ? { source_key: sourceKey } : {}),
          ...(chunking ? { chunking } : {}),
          ...(projectShared !== null ? { project_shared: projectShared } : {}),
          ...(metadata ? { metadata } : {}),
        });
      },
    });

    this.tools.set('mineru_ingest_pdf', {
      name: 'mineru_ingest_pdf',
      description: 'Ingest one PDF (URL or local file path) via MinerU into archival knowledge memory',
      parameters: {
        type: 'object',
        properties: {
          file_url: { type: 'string', description: 'Publicly accessible PDF URL' },
          file_path: { type: 'string', description: 'Local PDF absolute path' },
          title: { type: 'string', description: 'Optional title override' },
          source_key: { type: 'string', description: 'Optional stable source key' },
          options: {
            type: 'object',
            properties: {
              model_version: { type: 'string', enum: ['pipeline', 'vlm', 'MinerU-HTML'] },
              is_ocr: { type: 'boolean' },
              enable_formula: { type: 'boolean' },
              enable_table: { type: 'boolean' },
              language: { type: 'string' },
              page_ranges: { type: 'string' },
              no_cache: { type: 'boolean' },
              cache_tolerance: { type: 'number' },
              data_id: { type: 'string' },
            },
          },
          project_shared: { type: 'boolean', default: true },
          metadata: { type: 'object' },
        },
      },
      source: 'builtin',
      metadata: { risk_level: 'medium', mutating: true, supports_parallel: false },
      handler: async (params) => {
        const service = this.config.mineruIngestService;
        if (!service) {
          throw new ToolError('mineru ingest service is not configured', 'mineru_ingest_pdf');
        }
        const fileUrl = extractString(params['file_url']);
        const filePath = extractString(params['file_path']);
        if (!fileUrl && !filePath) {
          throw new ToolError('one of file_url or file_path is required', 'mineru_ingest_pdf');
        }
        if (fileUrl && filePath) {
          throw new ToolError(
            'file_url and file_path cannot both be set',
            'mineru_ingest_pdf'
          );
        }
        const title = extractString(params['title']);
        const sourceKey = extractString(params['source_key']);
        const projectShared = extractBoolean(params['project_shared']);
        const metadataRaw = params['metadata'];
        const metadata =
          typeof metadataRaw === 'object' && metadataRaw !== null
            ? (metadataRaw as Record<string, unknown>)
            : undefined;
        const optionsRaw = params['options'];
        const optionsObject =
          typeof optionsRaw === 'object' && optionsRaw !== null
            ? (optionsRaw as Record<string, unknown>)
            : null;
        const modelVersionRaw = optionsObject ? extractString(optionsObject['model_version']) : null;
        const modelVersion =
          modelVersionRaw && ['pipeline', 'vlm', 'MinerU-HTML'].includes(modelVersionRaw)
            ? (modelVersionRaw as 'pipeline' | 'vlm' | 'MinerU-HTML')
            : null;
        const options: MineruExtractOptions | undefined = optionsObject
          ? {
              ...(modelVersion
                ? { model_version: modelVersion }
                : {}),
              ...(extractBoolean(optionsObject['is_ocr']) !== null
                ? { is_ocr: extractBoolean(optionsObject['is_ocr']) as boolean }
                : {}),
              ...(extractBoolean(optionsObject['enable_formula']) !== null
                ? { enable_formula: extractBoolean(optionsObject['enable_formula']) as boolean }
                : {}),
              ...(extractBoolean(optionsObject['enable_table']) !== null
                ? { enable_table: extractBoolean(optionsObject['enable_table']) as boolean }
                : {}),
              ...(extractString(optionsObject['language'])
                ? { language: extractString(optionsObject['language']) as string }
                : {}),
              ...(extractString(optionsObject['page_ranges'])
                ? { page_ranges: extractString(optionsObject['page_ranges']) as string }
                : {}),
              ...(extractBoolean(optionsObject['no_cache']) !== null
                ? { no_cache: extractBoolean(optionsObject['no_cache']) as boolean }
                : {}),
              ...(extractNumber(optionsObject['cache_tolerance']) !== null
                ? { cache_tolerance: extractNumber(optionsObject['cache_tolerance']) as number }
                : {}),
              ...(extractString(optionsObject['data_id'])
                ? { data_id: extractString(optionsObject['data_id']) as string }
                : {}),
            }
          : undefined;

        return service.ingestPdf({
          scope: {
            orgId: this.scope.orgId,
            userId: this.scope.userId,
            projectId: this.scope.projectId,
          },
          ...(fileUrl ? { file_url: fileUrl } : {}),
          ...(filePath ? { file_path: filePath } : {}),
          ...(title ? { title } : {}),
          ...(sourceKey ? { source_key: sourceKey } : {}),
          ...(projectShared !== null ? { project_shared: projectShared } : {}),
          ...(metadata ? { metadata } : {}),
          ...(options ? { options } : {}),
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
      handler: (params) => {
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

        return Promise.resolve({
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
        });
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
      handler: (params) => {
        const skillId = extractString(params['skill_id']);
        if (!skillId) {
          throw new ToolError('skill_id is required', 'skills_get');
        }
        const skill = this.getSkillOrThrow(skillId);
        return Promise.resolve({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          provider: skill.provider,
          risk_level: skill.risk_level,
          health_status: skill.health_status,
          tools: skill.tools,
        });
      },
    });

    // ─── Escalation tool ──────────────────────────────────────

    this.tools.set('escalate_to_group', {
      name: 'escalate_to_group',
      description:
        'Escalate a complex task to a specialized group of agents. Use this when the task requires expertise or capabilities beyond your own.',
      parameters: {
        type: 'object',
        properties: {
          group_id: {
            type: 'string',
            description:
              'Optional. The ID of the group to escalate to. If not provided, a suitable group will be selected automatically based on the goal.',
          },
          goal: {
            type: 'string',
            description:
              'Clear description of what the group should accomplish',
          },
          context: {
            type: 'string',
            description:
              'Relevant context from the current conversation that the group needs to know',
          },
        },
        required: ['goal'],
      },
      source: 'builtin',
      metadata: {
        risk_level: 'medium',
        mutating: true,
        supports_parallel: false,
      },
      handler: async (params) => {
        const escalationService = this.config.escalationService;
        if (!escalationService) {
          throw new ToolError(
            'Escalation service is not configured',
            'escalate_to_group'
          );
        }
        if (!this.currentRunId || !this.currentSessionKey) {
          throw new ToolError(
            'Run context is not set; cannot escalate outside of a run',
            'escalate_to_group'
          );
        }

        const groupId = extractString(params['group_id']);
        const goal = extractString(params['goal']);
        const context = extractString(params['context']);

        if (!goal) {
          throw new ToolError('goal is required', 'escalate_to_group');
        }

        const result = await escalationService.escalate({
          parentRunId: this.currentRunId,
          scope: this.scope,
          sessionKey: this.currentSessionKey,
          goal,
          ...(groupId ? { groupId } : {}),
          ...(context ? { context } : {}),
          // Pass delegated permissions from current agent context (Phase C)
          ...(this.currentAgentContext?.delegatedPermissions
            ? { delegatedPermissions: this.currentAgentContext.delegatedPermissions }
            : {}),
        });

        return result;
      },
    });

    // ─── List available groups tool ──────────────────────────

    this.tools.set('list_available_groups', {
      name: 'list_available_groups',
      description:
        'List all available groups that can be escalated to, along with their capabilities.',
      parameters: {
        type: 'object',
        properties: {
          project_id: {
            type: 'string',
            description:
              "Optional. Filter groups by project. If not provided, uses the current run's project.",
          },
        },
      },
      source: 'builtin',
      metadata: {
        risk_level: 'low',
        mutating: false,
        supports_parallel: true,
      },
      handler: async (params) => {
        const groupRepository = this.config.groupRepository;
        if (!groupRepository) {
          throw new ToolError(
            'Group repository is not configured',
            'list_available_groups'
          );
        }

        const projectId =
          extractString(params['project_id']) ??
          this.scope.projectId ??
          undefined;

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
    });

    // ─── Coding tools ──────────────────────────────────────────

    this.tools.set('write_file', {
      name: 'write_file',
      description: 'Write content to a file in the workspace (creates or overwrites)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path within workspace' },
          content: { type: 'string', description: 'File content to write' },
        },
        required: ['path', 'content'],
      },
      source: 'builtin',
      metadata: { risk_level: 'medium', mutating: true, supports_parallel: false },
      handler: async (params) => {
        const filePath = extractString(params['path']);
        const content = params['content'];
        if (!filePath || typeof content !== 'string') {
          throw new ToolError('path and content are required', 'write_file');
        }
        const resolved = resolveWithinWorkDir(this.config.workDir, filePath);
        await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
        await fs.promises.writeFile(resolved, content, 'utf-8');
        return { path: filePath, bytes_written: Buffer.byteLength(content, 'utf-8') };
      },
    });

    this.tools.set('list_files', {
      name: 'list_files',
      description: 'List files and directories at a path in the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative directory path (default: ".")' },
        },
      },
      source: 'builtin',
      metadata: { risk_level: 'low', mutating: false, supports_parallel: true },
      handler: async (params) => {
        const dirPath = extractString(params['path']) ?? '.';
        const resolved = resolveWithinWorkDir(this.config.workDir, dirPath);
        const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
        return entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        }));
      },
    });

    this.tools.set('glob_files', {
      name: 'glob_files',
      description: 'Find files matching a glob pattern in the workspace',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. "src/**/*.ts")' },
          cwd: { type: 'string', description: 'Relative base directory (default: workspace root)' },
        },
        required: ['pattern'],
      },
      source: 'builtin',
      metadata: { risk_level: 'low', mutating: false, supports_parallel: true },
      handler: async (params) => {
        const pattern = extractString(params['pattern']);
        if (!pattern) {
          throw new ToolError('pattern is required', 'glob_files');
        }
        const cwd = extractString(params['cwd']) ?? '.';
        const resolved = resolveWithinWorkDir(this.config.workDir, cwd);
        // Use find as a portable glob fallback
        return new Promise((resolve, reject) => {
          execFile('find', [resolved, '-type', 'f', '-name', pattern.replace(/\*\*\//g, '')],
            { timeout: 10000, maxBuffer: 1024 * 512 },
            (err, stdout) => {
              if (err) { reject(new ToolError(`glob failed: ${err.message}`, 'glob_files')); return; }
              const files = stdout.trim().split('\n').filter(Boolean)
                .map((f) => path.relative(this.config.workDir, f));
              resolve({ pattern, matches: files.slice(0, 500), total: files.length });
            }
          );
        });
      },
    });

    this.tools.set('grep_files', {
      name: 'grep_files',
      description: 'Search file contents for a regex pattern in the workspace',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'Relative directory or file to search (default: ".")' },
          include: { type: 'string', description: 'File glob filter (e.g. "*.ts")' },
          max_results: { type: 'number', description: 'Max matches to return (default: 50)' },
        },
        required: ['pattern'],
      },
      source: 'builtin',
      metadata: { risk_level: 'low', mutating: false, supports_parallel: true },
      handler: async (params) => {
        const pattern = extractString(params['pattern']);
        if (!pattern) {
          throw new ToolError('pattern is required', 'grep_files');
        }
        const searchPath = extractString(params['path']) ?? '.';
        const include = extractString(params['include']);
        const maxResults = typeof params['max_results'] === 'number' ? params['max_results'] : 50;
        const resolved = resolveWithinWorkDir(this.config.workDir, searchPath);

        const args = ['-rn', '--color=never', '-E', pattern];
        if (include) args.push('--include', include);
        args.push(resolved);

        return new Promise((resolve, reject) => {
          execFile('grep', args,
            { timeout: 15000, maxBuffer: 1024 * 1024 },
            (err, stdout) => {
              // grep returns exit code 1 when no matches found
              if (err && (err as NodeJS.ErrnoException).code !== '1' && !stdout) {
                reject(new ToolError(`grep failed: ${err.message}`, 'grep_files'));
                return;
              }
              const lines = stdout.trim().split('\n').filter(Boolean);
              const matches = lines.slice(0, maxResults).map((line) => {
                const rel = line.startsWith(this.config.workDir)
                  ? line.slice(this.config.workDir.length + 1)
                  : line;
                return rel;
              });
              resolve({ pattern, matches, total: lines.length, truncated: lines.length > maxResults });
            }
          );
        });
      },
    });

    this.tools.set('exec_command', {
      name: 'exec_command',
      description: 'Execute a shell command in the workspace directory',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          timeout_ms: { type: 'number', description: 'Timeout in ms (default: 30000)' },
          cwd: { type: 'string', description: 'Working directory relative to workspace' },
        },
        required: ['command'],
      },
      source: 'builtin',
      metadata: { risk_level: 'high', mutating: true, supports_parallel: false },
      handler: async (params) => {
        const command = extractString(params['command']);
        if (!command) {
          throw new ToolError('command is required', 'exec_command');
        }
        const timeoutMs = typeof params['timeout_ms'] === 'number' ? params['timeout_ms'] : 30000;
        const cwdRel = extractString(params['cwd']);
        const cwd = cwdRel
          ? resolveWithinWorkDir(this.config.workDir, cwdRel)
          : this.config.workDir;

        return new Promise((resolve) => {
          execFile('sh', ['-c', command], {
            cwd,
            timeout: Math.min(timeoutMs, 120000),
            maxBuffer: 1024 * 1024,
          }, (err, stdout, stderr) => {
            resolve({
              exit_code: err ? (err as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0,
              stdout: stdout.slice(0, 50000),
              stderr: stderr.slice(0, 10000),
            });
          });
        });
      },
    });

    this.tools.set('apply_patch', {
      name: 'apply_patch',
      description: 'Apply a unified diff patch to a file in the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
          patch: { type: 'string', description: 'Unified diff content to apply' },
        },
        required: ['path', 'patch'],
      },
      source: 'builtin',
      metadata: { risk_level: 'medium', mutating: true, supports_parallel: false },
      handler: async (params) => {
        const filePath = extractString(params['path']);
        const patch = extractString(params['patch']);
        if (!filePath || !patch) {
          throw new ToolError('path and patch are required', 'apply_patch');
        }
        const resolved = resolveWithinWorkDir(this.config.workDir, filePath);

        // Simple line-based patch application
        const original = await fs.promises.readFile(resolved, 'utf-8');
        const lines = original.split('\n');
        const patchLines = patch.split('\n');
        let offset = 0;

        for (const pl of patchLines) {
          if (pl.startsWith('@@')) {
            const match = pl.match(/@@ -(\d+)/);
            const startLine = match?.[1];
            if (startLine !== undefined) {
              offset = parseInt(startLine, 10) - 1;
            }
          } else if (pl.startsWith('-') && !pl.startsWith('---')) {
            if (offset < lines.length) lines.splice(offset, 1);
          } else if (pl.startsWith('+') && !pl.startsWith('+++')) {
            lines.splice(offset, 0, pl.slice(1));
            offset++;
          } else if (!pl.startsWith('\\')) {
            offset++;
          }
        }

        const result = lines.join('\n');
        await fs.promises.writeFile(resolved, result, 'utf-8');
        return { path: filePath, applied: true };
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
      // Sanitize tool name: replace dots and other special chars with underscores
      const sanitizedName = tool.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      seen.add(sanitizedName);
      this.tools.set(sanitizedName, {
        name: sanitizedName,
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
