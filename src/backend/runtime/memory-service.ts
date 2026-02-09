import type { Pool, PoolClient } from 'pg';
import type {
  MemoryGetResponse,
  MemoryScope,
  MemorySearchResult,
  MemoryType,
  MemoryWriteRequest,
} from '../../types/memory.js';
import type { IEmbeddingProvider } from '../store/embedding-provider.js';
import { splitIntoChunks } from './text-chunker.js';
import { appendScopePredicate, toScopeContext } from './scope.js';

interface MemoryRow {
  id: string;
  type: MemoryType;
  text: string;
  metadata: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
}

interface SearchRow {
  id: string;
  type: MemoryType;
  snippet: string;
  score: number;
}

interface MemorySearchInput {
  query: string;
  scope: MemoryScope;
  top_k: number;
  filters?: Record<string, unknown>;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.map((value) => Number(value).toFixed(8)).join(',')}]`;
}

function normalizeScores(rows: SearchRow[]): Map<string, number> {
  const map = new Map<string, number>();
  const max = rows.reduce((acc, row) => Math.max(acc, row.score), 0);
  if (max <= 0) {
    return map;
  }
  for (const row of rows) {
    map.set(row.id, row.score / max);
  }
  return map;
}

function extractTypeFilter(filters: Record<string, unknown> | undefined): MemoryType[] {
  if (!filters) {
    return [];
  }
  const typeValue = filters['type'];
  if (typeof typeValue === 'string' && ['core', 'episodic', 'archival'].includes(typeValue)) {
    return [typeValue as MemoryType];
  }
  const listValue = filters['types'];
  if (Array.isArray(listValue)) {
    return listValue.filter(
      (value): value is MemoryType =>
        typeof value === 'string' && ['core', 'episodic', 'archival'].includes(value)
    );
  }
  return [];
}

export class MemoryService {
  constructor(
    private readonly pool: Pool,
    private readonly embeddingProvider: IEmbeddingProvider
  ) {}

  async memory_write(input: MemoryWriteRequest): Promise<{ id: string }> {
    const scope = toScopeContext(input.scope);
    const chunks = splitIntoChunks(input.text);
    const chunkTexts = chunks.map((chunk) => chunk.text);
    const embeddings = chunkTexts.length > 0
      ? await this.embeddingProvider.embedBatch(chunkTexts)
      : [];

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const memoryResult = await client.query<{ id: string }>(
        `INSERT INTO memories (
          org_id,
          user_id,
          project_id,
          type,
          text,
          metadata,
          importance
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
        RETURNING id::text AS id`,
        [
          scope.orgId,
          scope.userId,
          scope.projectId,
          input.type,
          input.text,
          JSON.stringify(input.metadata ?? {}),
          input.importance ?? 0.5,
        ]
      );
      const memoryId = memoryResult.rows[0]?.id;
      if (!memoryId) {
        throw new Error('Failed to insert memory item');
      }

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i];
        if (!chunk || !embedding) {
          continue;
        }
        await this.insertChunk(client, {
          memoryId,
          orgId: scope.orgId,
          userId: scope.userId,
          projectId: scope.projectId,
          chunkIndex: chunk.index,
          chunkText: chunk.text,
          snippet: chunk.snippet,
          embedding,
        });
      }

      await client.query('COMMIT');
      return { id: memoryId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async memory_get(id: string, scope: MemoryScope): Promise<MemoryGetResponse | null> {
    const scopeContext = toScopeContext(scope);
    const predicates: string[] = ['id = $1::uuid'];
    const params: unknown[] = [id];
    appendScopePredicate(predicates, params, scopeContext);

    const result = await this.pool.query<MemoryRow>(
      `SELECT id::text AS id, type, text, metadata, created_at, updated_at
      FROM memories
      WHERE ${predicates.join(' AND ')}
      LIMIT 1`,
      params
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      type: row.type,
      text: row.text,
      metadata: row.metadata ?? {},
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
    };
  }

  async memory_search(input: MemorySearchInput): Promise<MemorySearchResult[]> {
    const scope = toScopeContext(input.scope);
    const topK = Math.max(1, Math.min(input.top_k, 50));
    const typeFilters = extractTypeFilter(input.filters);
    const embedding = await this.embeddingProvider.embed(input.query);
    const vectorRows = await this.vectorSearch(scope, toVectorLiteral(embedding), topK, typeFilters);
    const ftsRows = await this.ftsSearch(scope, input.query, topK, typeFilters);

    const vectorScores = normalizeScores(vectorRows);
    const ftsScores = normalizeScores(ftsRows);
    const merged = new Map<string, MemorySearchResult>();

    const collect = (rows: SearchRow[], source: 'vector' | 'fts'): void => {
      for (const row of rows) {
        const vectorScore = vectorScores.get(row.id) ?? 0;
        const ftsScore = ftsScores.get(row.id) ?? 0;
        const score = vectorScore * 0.6 + ftsScore * 0.4;
        const existing = merged.get(row.id);
        if (!existing || score > existing.score) {
          merged.set(row.id, {
            id: row.id,
            snippet: row.snippet,
            score,
            type: row.type,
          });
        } else if (source === 'fts' && existing.snippet.length < row.snippet.length) {
          existing.snippet = row.snippet;
          merged.set(row.id, existing);
        }
      }
    };

    collect(vectorRows, 'vector');
    collect(ftsRows, 'fts');

    return [...merged.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private async vectorSearch(
    scope: ReturnType<typeof toScopeContext>,
    vectorLiteral: string,
    topK: number,
    typeFilters: MemoryType[]
  ): Promise<SearchRow[]> {
    const predicates: string[] = [];
    const params: unknown[] = [];
    appendScopePredicate(predicates, params, scope, 'mc');
    if (typeFilters.length > 0) {
      const filterIndex = params.push(typeFilters);
      predicates.push(`m.type = ANY($${filterIndex}::text[])`);
    }
    const vectorIndex = params.push(vectorLiteral);
    const limitIndex = params.push(topK * 3);
    const whereSql = predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '';

    const result = await this.pool.query<SearchRow>(
      `SELECT
        mc.memory_id::text AS id,
        m.type AS type,
        mc.snippet AS snippet,
        (1 - (mc.embedding <=> $${vectorIndex}::vector))::float8 AS score
      FROM memory_chunks mc
      JOIN memories m ON m.id = mc.memory_id
      ${whereSql}
      ORDER BY mc.embedding <=> $${vectorIndex}::vector ASC
      LIMIT $${limitIndex}`,
      params
    );

    if (result.rows.length === 0) {
      return [];
    }

    return this.keepBestRows(result.rows);
  }

  private async ftsSearch(
    scope: ReturnType<typeof toScopeContext>,
    query: string,
    topK: number,
    typeFilters: MemoryType[]
  ): Promise<SearchRow[]> {
    const predicates: string[] = [];
    const params: unknown[] = [];
    appendScopePredicate(predicates, params, scope, 'mc');
    if (typeFilters.length > 0) {
      const filterIndex = params.push(typeFilters);
      predicates.push(`m.type = ANY($${filterIndex}::text[])`);
    }
    const queryIndex = params.push(query);
    predicates.push(`mc.search_tsv @@ plainto_tsquery('simple', $${queryIndex})`);
    const limitIndex = params.push(topK * 3);

    const result = await this.pool.query<SearchRow>(
      `SELECT
        mc.memory_id::text AS id,
        m.type AS type,
        COALESCE(
          ts_headline(
            'simple',
            mc.chunk_text,
            plainto_tsquery('simple', $${queryIndex}),
            'StartSel=,StopSel=,MaxFragments=1,MaxWords=20,MinWords=8'
          ),
          mc.snippet
        ) AS snippet,
        ts_rank_cd(mc.search_tsv, plainto_tsquery('simple', $${queryIndex}))::float8 AS score
      FROM memory_chunks mc
      JOIN memories m ON m.id = mc.memory_id
      WHERE ${predicates.join(' AND ')}
      ORDER BY score DESC
      LIMIT $${limitIndex}`,
      params
    );

    if (result.rows.length === 0) {
      return [];
    }

    return this.keepBestRows(result.rows);
  }

  private keepBestRows(rows: SearchRow[]): SearchRow[] {
    const byMemory = new Map<string, SearchRow>();
    for (const row of rows) {
      const existing = byMemory.get(row.id);
      if (!existing || row.score > existing.score) {
        byMemory.set(row.id, row);
      }
    }
    return [...byMemory.values()];
  }

  private async insertChunk(
    client: PoolClient,
    input: {
      memoryId: string;
      orgId: string;
      userId: string;
      projectId: string | null;
      chunkIndex: number;
      chunkText: string;
      snippet: string;
      embedding: number[];
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO memory_chunks (
        memory_id,
        org_id,
        user_id,
        project_id,
        chunk_index,
        chunk_text,
        snippet,
        embedding
      ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::vector)`,
      [
        input.memoryId,
        input.orgId,
        input.userId,
        input.projectId,
        input.chunkIndex,
        input.chunkText,
        input.snippet,
        toVectorLiteral(input.embedding),
      ]
    );
  }
}
