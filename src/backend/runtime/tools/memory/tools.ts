import type { RuntimeTool, ToolContext } from '../_helpers.js';
import { extractString } from '../_helpers.js';
import { ToolError } from '../../../../utils/errors.js';

export function register(ctx: ToolContext): RuntimeTool[] {
  return [
    {
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
        if (!query) throw new ToolError('query is required', 'memory_search');
        const topKRaw = params['top_k'];
        const topK = typeof topKRaw === 'number' && Number.isFinite(topKRaw) ? Math.floor(topKRaw) : 8;
        const filters = params['filters'];
        return ctx.memoryService.memory_search({
          query,
          scope: {
            org_id: ctx.scope.orgId,
            user_id: ctx.scope.userId,
            ...(ctx.scope.projectId ? { project_id: ctx.scope.projectId } : {}),
          },
          top_k: topK,
          ...(typeof filters === 'object' && filters !== null
            ? { filters: filters as Record<string, unknown> }
            : {}),
        });
      },
    },
    {
      name: 'memory_get',
      description: 'Read full memory by id',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      source: 'builtin',
      handler: async (params) => {
        const id = extractString(params['id']);
        if (!id) throw new ToolError('id is required', 'memory_get');
        return ctx.memoryService.memory_get(id, {
          org_id: ctx.scope.orgId,
          user_id: ctx.scope.userId,
          ...(ctx.scope.projectId ? { project_id: ctx.scope.projectId } : {}),
        });
      },
    },
    {
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
        if (!type || !text) throw new ToolError('type and text are required', 'memory_write');
        if (!['core', 'episodic', 'archival'].includes(type)) {
          throw new ToolError('invalid memory type', 'memory_write');
        }
        const metadata = params['metadata'];
        const importance = params['importance'];
        return ctx.memoryService.memory_write({
          type: type as 'core' | 'episodic' | 'archival',
          scope: {
            org_id: ctx.scope.orgId,
            user_id: ctx.scope.userId,
            ...(ctx.scope.projectId ? { project_id: ctx.scope.projectId } : {}),
          },
          text,
          metadata: typeof metadata === 'object' && metadata !== null
            ? (metadata as Record<string, unknown>)
            : undefined,
          importance: typeof importance === 'number' ? importance : undefined,
        });
      },
    },
  ];
}
