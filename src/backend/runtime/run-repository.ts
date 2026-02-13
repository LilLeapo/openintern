import type { Pool, PoolClient } from 'pg';
import type { LLMConfigRequest } from '../../types/api.js';
import type { RunMeta } from '../../types/run.js';
import { NotFoundError } from '../../utils/errors.js';
import type { Event } from '../../types/events.js';
import type { DelegatedPermissions, EventCursorPage, RunCreateInput, RunRecord, RunStatus } from './models.js';
import { appendScopePredicate, type ScopeContext } from './scope.js';

interface RunRow {
  id: string;
  org_id: string;
  user_id: string;
  project_id: string | null;
  session_key: string;
  input: string;
  status: RunStatus;
  agent_id: string;
  llm_config: LLMConfigRequest | null;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  parent_run_id: string | null;
  delegated_permissions: DelegatedPermissions | null;
  created_at: string | Date;
  started_at: string | Date | null;
  ended_at: string | Date | null;
  cancelled_at: string | Date | null;
  event_count?: string;
  tool_count?: string;
}

interface EventRow {
  id: string | number;
  ts: string | Date;
  agent_id: string;
  step_id: string;
  type: Event['type'];
  payload: Event['payload'];
  v: number;
  span_id: string;
  parent_span_id: string | null;
  redaction: Event['redaction'];
}

function toIso(value: string | Date | null): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRunRow(row: RunRow): RunRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    projectId: row.project_id,
    sessionKey: row.session_key,
    input: row.input,
    status: row.status,
    agentId: row.agent_id,
    llmConfig: row.llm_config,
    result: row.result,
    error: row.error,
    parentRunId: row.parent_run_id ?? null,
    delegatedPermissions: row.delegated_permissions ?? null,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    startedAt: toIso(row.started_at),
    endedAt: toIso(row.ended_at),
    cancelledAt: toIso(row.cancelled_at),
  };
}

function castBigintCursor(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

export class RunRepository {
  constructor(private readonly pool: Pool) {}

  async createRun(input: RunCreateInput): Promise<RunRecord> {
    const result = await this.pool.query<RunRow>(
      `INSERT INTO runs (
        id,
        org_id,
        user_id,
        project_id,
        session_key,
        input,
        status,
        agent_id,
        llm_config,
        parent_run_id,
        delegated_permissions
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10::jsonb)
      RETURNING *`,
      [
        input.id,
        input.scope.orgId,
        input.scope.userId,
        input.scope.projectId,
        input.sessionKey,
        input.input,
        input.agentId,
        input.llmConfig,
        input.parentRunId ?? null,
        input.delegatedPermissions ? JSON.stringify(input.delegatedPermissions) : null,
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to create run');
    }
    return mapRunRow(row);
  }

  async getRun(runId: string, scope: ScopeContext): Promise<RunRecord | null> {
    const clauses: string[] = ['id = $1'];
    const params: unknown[] = [runId];
    appendScopePredicate(clauses, params, scope);

    const result = await this.pool.query<RunRow>(
      `SELECT * FROM runs WHERE ${clauses.join(' AND ')} LIMIT 1`,
      params
    );
    const row = result.rows[0];
    return row ? mapRunRow(row) : null;
  }

  async requireRun(runId: string, scope: ScopeContext): Promise<RunRecord> {
    const run = await this.getRun(runId, scope);
    if (!run) {
      throw new NotFoundError('Run', runId);
    }
    return run;
  }

  async setRunRunning(runId: string): Promise<void> {
    await this.pool.query(
      `UPDATE runs
      SET status = 'running',
          started_at = COALESCE(started_at, NOW())
      WHERE id = $1
        AND status = 'pending'`,
      [runId]
    );
  }

  async setRunCompleted(runId: string, output: string): Promise<void> {
    await this.pool.query(
      `UPDATE runs
      SET status = 'completed',
          ended_at = NOW(),
          result = $2::jsonb
      WHERE id = $1
        AND status = 'running'`,
      [runId, JSON.stringify({ output })]
    );
  }

  async setRunFailed(runId: string, error: { code: string; message: string }): Promise<void> {
    await this.pool.query(
      `UPDATE runs
      SET status = 'failed',
          ended_at = NOW(),
          error = $2::jsonb
      WHERE id = $1
        AND status = 'running'`,
      [runId, JSON.stringify(error)]
    );
  }

  async setRunCancelled(runId: string): Promise<void> {
    await this.pool.query(
      `UPDATE runs
      SET status = 'cancelled',
          cancelled_at = NOW(),
          ended_at = NOW()
      WHERE id = $1
        AND status IN ('pending', 'running', 'waiting')`,
      [runId]
    );
  }

  async setRunWaiting(runId: string): Promise<void> {
    await this.pool.query(
      `UPDATE runs
      SET status = 'waiting'
      WHERE id = $1
        AND status = 'running'`,
      [runId]
    );
  }

  async setRunResumed(runId: string): Promise<void> {
    await this.pool.query(
      `UPDATE runs
      SET status = 'running'
      WHERE id = $1
        AND status = 'waiting'`,
      [runId]
    );
  }

  async getRunById(runId: string): Promise<RunRecord | null> {
    const result = await this.pool.query<RunRow>(
      `SELECT * FROM runs WHERE id = $1 LIMIT 1`,
      [runId]
    );
    const row = result.rows[0];
    return row ? mapRunRow(row) : null;
  }

  async listRunsBySession(
    scope: ScopeContext,
    sessionKey: string,
    page: number,
    limit: number
  ): Promise<{ runs: RunMeta[]; total: number }> {
    const offset = (page - 1) * limit;
    const predicates: string[] = [
      'session_key = $1',
      'org_id = $2',
      'user_id = $3',
      'project_id IS NOT DISTINCT FROM $4',
    ];
    const countParams: unknown[] = [sessionKey, scope.orgId, scope.userId, scope.projectId];

    const countResult = await this.pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM runs WHERE ${predicates.join(' AND ')}`,
      countParams
    );

    const dataParams = [...countParams, limit, offset];
    const runRows = await this.pool.query<RunRow>(
      `SELECT
        r.*,
        COALESCE(stats.event_count, 0)::text AS event_count,
        COALESCE(stats.tool_count, 0)::text AS tool_count
      FROM runs
      AS r
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS event_count,
          COUNT(*) FILTER (WHERE type = 'tool.called') AS tool_count
        FROM events e
        WHERE e.run_id = r.id
      ) AS stats ON TRUE
      WHERE r.session_key = $1
        AND r.org_id = $2
        AND r.user_id = $3
        AND r.project_id IS NOT DISTINCT FROM $4
      ORDER BY r.created_at DESC
      LIMIT $${countParams.length + 1}
      OFFSET $${countParams.length + 2}`,
      dataParams
    );

    const runs = runRows.rows.map((row) => this.toRunMeta(row));
    const total = Number.parseInt(countResult.rows[0]?.total ?? '0', 10);
    return { runs, total };
  }

  private toRunMeta(row: RunRow): RunMeta {
    const started = toIso(row.started_at) ?? toIso(row.created_at) ?? new Date().toISOString();
    const ended = toIso(row.ended_at);
    const durationMs =
      ended && started ? new Date(ended).getTime() - new Date(started).getTime() : null;
    return {
      run_id: row.id,
      session_key: row.session_key,
      status: row.status,
      started_at: started,
      ended_at: ended,
      duration_ms: durationMs,
      event_count: Number.parseInt(row.event_count ?? '0', 10),
      tool_call_count: Number.parseInt(row.tool_count ?? '0', 10),
    };
  }

  async appendEvent(event: Event): Promise<number> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO events (
        run_id,
        ts,
        agent_id,
        step_id,
        type,
        payload,
        v,
        span_id,
        parent_span_id,
        redaction
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb)
      RETURNING id::text AS id`,
      [
        event.run_id,
        event.ts,
        event.agent_id,
        event.step_id,
        event.type,
        JSON.stringify(event.payload),
        event.v,
        event.span_id,
        event.parent_span_id,
        JSON.stringify(event.redaction),
      ]
    );
    return Number.parseInt(result.rows[0]?.id ?? '0', 10);
  }

  async appendEvents(events: Event[]): Promise<number[]> {
    if (events.length === 0) {
      return [];
    }

    const values: string[] = [];
    const params: unknown[] = [];
    for (const event of events) {
      const offset = params.length;
      values.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}::jsonb, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}::jsonb)`
      );
      params.push(
        event.run_id,
        event.ts,
        event.agent_id,
        event.step_id,
        event.type,
        JSON.stringify(event.payload),
        event.v,
        event.span_id,
        event.parent_span_id,
        JSON.stringify(event.redaction)
      );
    }

    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO events (
        run_id,
        ts,
        agent_id,
        step_id,
        type,
        payload,
        v,
        span_id,
        parent_span_id,
        redaction
      ) VALUES ${values.join(',')}
      RETURNING id::text AS id`,
      params
    );

    return result.rows.map((row) => Number.parseInt(row.id, 10));
  }

  async getRunEvents(
    runId: string,
    scope: ScopeContext,
    cursor: string | undefined,
    limit: number
  ): Promise<EventCursorPage<Event>> {
    const run = await this.requireRun(runId, scope);
    const cursorValue = cursor ? castBigintCursor(cursor) : 0;
    const result = await this.pool.query<EventRow>(
      `SELECT
        id,
        ts,
        agent_id,
        step_id,
        type,
        payload,
        v,
        span_id,
        parent_span_id,
        redaction
      FROM events
      WHERE run_id = $1
        AND id > $2
      ORDER BY id ASC
      LIMIT $3`,
      [run.id, cursorValue, limit]
    );

    const items = result.rows.map((row) => ({
      v: row.v === 1 ? 1 : 1,
      ts: toIso(row.ts) ?? new Date().toISOString(),
      session_key: run.sessionKey,
      run_id: run.id,
      agent_id: row.agent_id,
      step_id: row.step_id,
      span_id: row.span_id,
      parent_span_id: row.parent_span_id,
      type: row.type,
      payload: row.payload,
      redaction: row.redaction,
    })) as Event[];
    const nextCursorRow = result.rows[result.rows.length - 1];
    const nextCursor = nextCursorRow ? String(nextCursorRow.id) : null;
    return { items, nextCursor };
  }

  async createCheckpoint(
    runId: string,
    agentId: string,
    stepId: string,
    state: Record<string, unknown>
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO checkpoints (run_id, agent_id, step_id, state)
      VALUES ($1, $2, $3, $4::jsonb)`,
      [runId, agentId, stepId, JSON.stringify(state)]
    );
  }

  async getLatestCheckpoint(
    runId: string,
    agentId: string
  ): Promise<{ stepId: string; state: Record<string, unknown> } | null> {
    const result = await this.pool.query<{
      step_id: string;
      state: Record<string, unknown>;
    }>(
      `SELECT step_id, state
      FROM checkpoints
      WHERE run_id = $1
        AND agent_id = $2
      ORDER BY id DESC
      LIMIT 1`,
      [runId, agentId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return { stepId: row.step_id, state: row.state };
  }

  async cancelPendingRun(
    runId: string,
    scope: ScopeContext,
    client?: PoolClient
  ): Promise<boolean> {
    const db = client ?? this.pool;
    const clauses: string[] = ['id = $1', `status = 'pending'`];
    const params: unknown[] = [runId];
    appendScopePredicate(clauses, params, scope);

    const result = await db.query<{ id: string }>(
      `UPDATE runs
      SET status = 'cancelled',
          cancelled_at = NOW(),
          ended_at = NOW()
      WHERE ${clauses.join(' AND ')}
      RETURNING id`,
      params
    );
    return (result.rowCount ?? 0) > 0;
  }

  async countEventsAndTools(runId: string): Promise<{ eventCount: number; toolCalls: number }> {
    const result = await this.pool.query<{
      event_count: string;
      tool_count: string;
    }>(
      `SELECT
        COUNT(*)::text AS event_count,
        COUNT(*) FILTER (WHERE type = 'tool.called')::text AS tool_count
      FROM events
      WHERE run_id = $1`,
      [runId]
    );
    const row = result.rows[0];
    return {
      eventCount: Number.parseInt(row?.event_count ?? '0', 10),
      toolCalls: Number.parseInt(row?.tool_count ?? '0', 10),
    };
  }
}
