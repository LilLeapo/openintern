/**
 * PostgreSQL schema statements for the runtime.
 *
 * Notes:
 * - `vector` extension is required for pgvector embeddings.
 * - `pgcrypto` is used for UUID generation.
 * - all statements are idempotent.
 */
export const POSTGRES_SCHEMA_STATEMENTS: string[] = [
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
  `CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT,
    session_key TEXT NOT NULL,
    input TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    agent_id TEXT NOT NULL DEFAULT 'main',
    llm_config JSONB,
    result JSONB,
    error JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS runs_scope_created_idx
    ON runs (org_id, user_id, project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS runs_scope_session_created_idx
    ON runs (org_id, user_id, project_id, session_key, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    ts TIMESTAMPTZ NOT NULL,
    agent_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    v INTEGER NOT NULL DEFAULT 1,
    span_id TEXT NOT NULL,
    parent_span_id TEXT,
    redaction JSONB NOT NULL DEFAULT '{"contains_secrets": false}'::jsonb
  )`,
  `CREATE INDEX IF NOT EXISTS events_run_id_idx ON events (run_id, id)`,
  `CREATE INDEX IF NOT EXISTS events_run_ts_idx ON events (run_id, ts)`,
  `CREATE TABLE IF NOT EXISTS checkpoints (
    id BIGSERIAL PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    state JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS checkpoints_run_agent_idx
    ON checkpoints (run_id, agent_id, id DESC)`,
  `CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT,
    type TEXT NOT NULL CHECK (type IN ('core', 'episodic', 'archival')),
    text TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    importance REAL NOT NULL DEFAULT 0.5,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS memories_scope_created_idx
    ON memories (org_id, user_id, project_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS memory_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    snippet TEXT NOT NULL,
    embedding VECTOR(256) NOT NULL,
    search_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', chunk_text)) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS memory_chunks_scope_idx
    ON memory_chunks (org_id, user_id, project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS memory_chunks_memory_id_idx
    ON memory_chunks (memory_id, chunk_index)`,
  `CREATE INDEX IF NOT EXISTS memory_chunks_search_idx
    ON memory_chunks USING GIN (search_tsv)`,
  `CREATE INDEX IF NOT EXISTS memory_chunks_embedding_idx
    ON memory_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`,

  // ─── Phase 0: Orchestrator tables ──────────────────────────

  `CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL,
    allowed_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
    denied_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
    style_constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_lead BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    project_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS groups_project_idx ON groups (project_id)`,

  `CREATE TABLE IF NOT EXISTS agent_instances (
    id TEXT PRIMARY KEY,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    project_id TEXT,
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    state JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS agent_instances_role_idx ON agent_instances (role_id)`,
  `CREATE INDEX IF NOT EXISTS agent_instances_project_idx ON agent_instances (project_id)`,

  `CREATE TABLE IF NOT EXISTS group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    agent_instance_id TEXT REFERENCES agent_instances(id) ON DELETE SET NULL,
    ordinal INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS group_members_group_idx ON group_members (group_id, ordinal)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS group_members_group_role_idx ON group_members (group_id, role_id)`,

  // ─── Phase 2: Skills table ───────────────────────────────────

  `CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tools JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
    provider TEXT NOT NULL DEFAULT 'builtin' CHECK (provider IN ('builtin', 'mcp')),
    health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'unhealthy', 'unknown')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS skills_provider_idx ON skills (provider)`,
  `CREATE INDEX IF NOT EXISTS skills_risk_level_idx ON skills (risk_level)`,

  // Add group_id to runs table (idempotent)
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'runs' AND column_name = 'group_id'
    ) THEN
      ALTER TABLE runs ADD COLUMN group_id TEXT;
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS runs_group_idx ON runs (group_id)`,

  // Add group_id and message_type to events table (idempotent)
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'events' AND column_name = 'group_id'
    ) THEN
      ALTER TABLE events ADD COLUMN group_id TEXT;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'events' AND column_name = 'message_type'
    ) THEN
      ALTER TABLE events ADD COLUMN message_type TEXT;
    END IF;
  END $$`,
];
