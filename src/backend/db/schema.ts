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
];
