import type { Pool } from 'pg';
import type {
  FeishuConnector,
  FeishuConnectorConfig,
  FeishuConnectorStatus,
  FeishuSyncJob,
  FeishuSyncStats,
  FeishuSyncTrigger,
} from '../../types/feishu.js';
import { generateFeishuConnectorId, generateFeishuSyncJobId } from '../../utils/ids.js';
import { NotFoundError } from '../../utils/errors.js';

interface FeishuConnectorRow {
  id: string;
  org_id: string;
  project_id: string;
  name: string;
  status: FeishuConnectorStatus;
  config: FeishuConnectorConfig;
  created_by: string;
  last_sync_at: string | Date | null;
  last_success_at: string | Date | null;
  last_error: string | null;
  last_polled_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface FeishuSyncJobRow {
  id: string;
  connector_id: string;
  org_id: string;
  project_id: string;
  trigger: FeishuSyncTrigger;
  status: FeishuSyncJob['status'];
  started_at: string | Date | null;
  ended_at: string | Date | null;
  stats: FeishuSyncStats;
  error_message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface FeishuSourceStateRow {
  connector_id: string;
  source_key: string;
  source_type: 'docx' | 'bitable';
  source_id: string;
  revision_id: string | null;
  content_hash: string | null;
  metadata: Record<string, unknown>;
  updated_at: string | Date | null;
  last_synced_at: string | Date;
}

export interface FeishuSourceState {
  connector_id: string;
  source_key: string;
  source_type: 'docx' | 'bitable';
  source_id: string;
  revision_id: string | null;
  content_hash: string | null;
  metadata: Record<string, unknown>;
  updated_at: string | null;
  last_synced_at: string;
}

function toIso(value: string | Date | null): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapConnectorRow(row: FeishuConnectorRow): FeishuConnector {
  return {
    id: row.id,
    org_id: row.org_id,
    project_id: row.project_id,
    name: row.name,
    status: row.status,
    config: row.config,
    created_by: row.created_by,
    last_sync_at: toIso(row.last_sync_at),
    last_success_at: toIso(row.last_success_at),
    last_error: row.last_error,
    last_polled_at: toIso(row.last_polled_at),
    created_at: toIso(row.created_at) ?? new Date().toISOString(),
    updated_at: toIso(row.updated_at) ?? new Date().toISOString(),
  };
}

function mapJobRow(row: FeishuSyncJobRow): FeishuSyncJob {
  return {
    id: row.id,
    connector_id: row.connector_id,
    org_id: row.org_id,
    project_id: row.project_id,
    trigger: row.trigger,
    status: row.status,
    started_at: toIso(row.started_at),
    ended_at: toIso(row.ended_at),
    stats: row.stats,
    error_message: row.error_message,
    created_at: toIso(row.created_at) ?? new Date().toISOString(),
    updated_at: toIso(row.updated_at) ?? new Date().toISOString(),
  };
}

function mapSourceStateRow(row: FeishuSourceStateRow): FeishuSourceState {
  return {
    connector_id: row.connector_id,
    source_key: row.source_key,
    source_type: row.source_type,
    source_id: row.source_id,
    revision_id: row.revision_id,
    content_hash: row.content_hash,
    metadata: row.metadata ?? {},
    updated_at: toIso(row.updated_at),
    last_synced_at: toIso(row.last_synced_at) ?? new Date().toISOString(),
  };
}

const DEFAULT_STATS: FeishuSyncStats = {
  discovered: 0,
  processed: 0,
  skipped: 0,
  failed: 0,
  docx_docs: 0,
  bitable_tables: 0,
  chunk_count: 0,
};

export class FeishuRepository {
  constructor(private readonly pool: Pool) {}

  async createConnector(input: {
    orgId: string;
    projectId: string;
    createdBy: string;
    name: string;
    status: FeishuConnectorStatus;
    config: FeishuConnectorConfig;
  }): Promise<FeishuConnector> {
    const id = generateFeishuConnectorId();
    const result = await this.pool.query<FeishuConnectorRow>(
      `INSERT INTO feishu_connectors (
        id, org_id, project_id, name, status, config, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      RETURNING *`,
      [
        id,
        input.orgId,
        input.projectId,
        input.name,
        input.status,
        JSON.stringify(input.config),
        input.createdBy,
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to create Feishu connector');
    }
    return mapConnectorRow(row);
  }

  async listConnectors(scope: { orgId: string; projectId: string }): Promise<FeishuConnector[]> {
    const result = await this.pool.query<FeishuConnectorRow>(
      `SELECT * FROM feishu_connectors
      WHERE org_id = $1 AND project_id = $2
      ORDER BY created_at DESC`,
      [scope.orgId, scope.projectId]
    );
    return result.rows.map(mapConnectorRow);
  }

  async listActiveConnectors(): Promise<FeishuConnector[]> {
    const result = await this.pool.query<FeishuConnectorRow>(
      `SELECT * FROM feishu_connectors
      WHERE status = 'active'
      ORDER BY COALESCE(last_polled_at, '1970-01-01'::timestamptz) ASC`
    );
    return result.rows.map(mapConnectorRow);
  }

  async getConnector(
    scope: { orgId: string; projectId: string },
    connectorId: string
  ): Promise<FeishuConnector | null> {
    const result = await this.pool.query<FeishuConnectorRow>(
      `SELECT * FROM feishu_connectors
      WHERE id = $1 AND org_id = $2 AND project_id = $3
      LIMIT 1`,
      [connectorId, scope.orgId, scope.projectId]
    );
    const row = result.rows[0];
    return row ? mapConnectorRow(row) : null;
  }

  async requireConnector(
    scope: { orgId: string; projectId: string },
    connectorId: string
  ): Promise<FeishuConnector> {
    const connector = await this.getConnector(scope, connectorId);
    if (!connector) {
      throw new NotFoundError('Feishu connector', connectorId);
    }
    return connector;
  }

  async updateConnector(
    scope: { orgId: string; projectId: string },
    connectorId: string,
    patch: {
      name?: string;
      status?: FeishuConnectorStatus;
      config?: FeishuConnectorConfig;
    }
  ): Promise<FeishuConnector> {
    const updates: string[] = [];
    const params: unknown[] = [connectorId, scope.orgId, scope.projectId];

    if (patch.name !== undefined) {
      updates.push(`name = $${params.push(patch.name)}`);
    }
    if (patch.status !== undefined) {
      updates.push(`status = $${params.push(patch.status)}`);
    }
    if (patch.config !== undefined) {
      updates.push(`config = $${params.push(JSON.stringify(patch.config))}::jsonb`);
    }
    if (updates.length === 0) {
      return this.requireConnector(scope, connectorId);
    }
    updates.push('updated_at = NOW()');

    const result = await this.pool.query<FeishuConnectorRow>(
      `UPDATE feishu_connectors
      SET ${updates.join(', ')}
      WHERE id = $1 AND org_id = $2 AND project_id = $3
      RETURNING *`,
      params
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Feishu connector', connectorId);
    }
    return mapConnectorRow(row);
  }

  async touchConnectorPolledAt(connectorId: string): Promise<void> {
    await this.pool.query(
      `UPDATE feishu_connectors
      SET last_polled_at = NOW(),
          updated_at = NOW()
      WHERE id = $1`,
      [connectorId]
    );
  }

  async updateConnectorSyncResult(input: {
    connectorId: string;
    success: boolean;
    errorMessage: string | null;
  }): Promise<void> {
    if (input.success) {
      await this.pool.query(
        `UPDATE feishu_connectors
        SET last_sync_at = NOW(),
            last_success_at = NOW(),
            last_error = NULL,
            updated_at = NOW()
        WHERE id = $1`,
        [input.connectorId]
      );
      return;
    }

    await this.pool.query(
      `UPDATE feishu_connectors
      SET last_sync_at = NOW(),
          last_error = $2,
          updated_at = NOW()
      WHERE id = $1`,
      [input.connectorId, input.errorMessage]
    );
  }

  async createSyncJob(input: {
    connectorId: string;
    orgId: string;
    projectId: string;
    trigger: FeishuSyncTrigger;
  }): Promise<FeishuSyncJob> {
    const id = generateFeishuSyncJobId();
    const result = await this.pool.query<FeishuSyncJobRow>(
      `INSERT INTO feishu_sync_jobs (
        id, connector_id, org_id, project_id, trigger, status, stats
      ) VALUES ($1, $2, $3, $4, $5, 'pending', $6::jsonb)
      RETURNING *`,
      [id, input.connectorId, input.orgId, input.projectId, input.trigger, JSON.stringify(DEFAULT_STATS)]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to create Feishu sync job');
    }
    return mapJobRow(row);
  }

  async setSyncJobRunning(jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE feishu_sync_jobs
      SET status = 'running',
          started_at = NOW(),
          updated_at = NOW()
      WHERE id = $1`,
      [jobId]
    );
  }

  async setSyncJobCompleted(jobId: string, stats: FeishuSyncStats): Promise<FeishuSyncJob> {
    const result = await this.pool.query<FeishuSyncJobRow>(
      `UPDATE feishu_sync_jobs
      SET status = 'completed',
          stats = $2::jsonb,
          ended_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
      [jobId, JSON.stringify(stats)]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Feishu sync job', jobId);
    }
    return mapJobRow(row);
  }

  async setSyncJobFailed(
    jobId: string,
    stats: FeishuSyncStats,
    errorMessage: string
  ): Promise<FeishuSyncJob> {
    const result = await this.pool.query<FeishuSyncJobRow>(
      `UPDATE feishu_sync_jobs
      SET status = 'failed',
          stats = $2::jsonb,
          error_message = $3,
          ended_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
      [jobId, JSON.stringify(stats), errorMessage]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Feishu sync job', jobId);
    }
    return mapJobRow(row);
  }

  async listSyncJobs(
    scope: { orgId: string; projectId: string },
    connectorId: string,
    limit: number
  ): Promise<FeishuSyncJob[]> {
    const result = await this.pool.query<FeishuSyncJobRow>(
      `SELECT * FROM feishu_sync_jobs
      WHERE connector_id = $1 AND org_id = $2 AND project_id = $3
      ORDER BY created_at DESC
      LIMIT $4`,
      [connectorId, scope.orgId, scope.projectId, limit]
    );
    return result.rows.map(mapJobRow);
  }

  async getRunningJob(connectorId: string): Promise<FeishuSyncJob | null> {
    const result = await this.pool.query<FeishuSyncJobRow>(
      `SELECT * FROM feishu_sync_jobs
      WHERE connector_id = $1 AND status = 'running'
      ORDER BY created_at DESC
      LIMIT 1`,
      [connectorId]
    );
    const row = result.rows[0];
    return row ? mapJobRow(row) : null;
  }

  async getSourceState(
    connectorId: string,
    sourceKey: string
  ): Promise<FeishuSourceState | null> {
    const result = await this.pool.query<FeishuSourceStateRow>(
      `SELECT * FROM feishu_source_state
      WHERE connector_id = $1 AND source_key = $2
      LIMIT 1`,
      [connectorId, sourceKey]
    );
    const row = result.rows[0];
    return row ? mapSourceStateRow(row) : null;
  }

  async upsertSourceState(input: {
    connectorId: string;
    sourceKey: string;
    sourceType: 'docx' | 'bitable';
    sourceId: string;
    revisionId: string | null;
    contentHash: string;
    metadata: Record<string, unknown>;
    updatedAt: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO feishu_source_state (
        connector_id, source_key, source_type, source_id,
        revision_id, content_hash, metadata, updated_at, last_synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, NOW())
      ON CONFLICT (connector_id, source_key)
      DO UPDATE SET
        source_type = EXCLUDED.source_type,
        source_id = EXCLUDED.source_id,
        revision_id = EXCLUDED.revision_id,
        content_hash = EXCLUDED.content_hash,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at,
        last_synced_at = NOW()`,
      [
        input.connectorId,
        input.sourceKey,
        input.sourceType,
        input.sourceId,
        input.revisionId,
        input.contentHash,
        JSON.stringify(input.metadata),
        input.updatedAt,
      ]
    );
  }
}
