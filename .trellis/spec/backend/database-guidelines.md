# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

The project uses PostgreSQL via the `pg` library (no ORM). Queries are written as raw SQL strings with parameterized placeholders (`$1`, `$2`, ...). The database layer lives in `src/backend/db/` for connection/schema management and `src/backend/runtime/` for repository classes.

Key dependencies: `pg` for the driver, `pgvector` extension for embeddings, `pgcrypto` for UUID generation.

---

## Query Patterns

All queries use parameterized placeholders. Never interpolate values into SQL strings.

```typescript
// CORRECT: parameterized query (see src/backend/runtime/run-repository.ts lines 81-104)
const result = await this.pool.query<RunRow>(
  `INSERT INTO runs (id, org_id, user_id, project_id, session_key, input, status, agent_id, llm_config)
   VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
   RETURNING *`,
  [input.id, input.scope.orgId, input.scope.userId, input.scope.projectId,
   input.sessionKey, input.input, input.agentId, input.llmConfig]
);
```

JSONB columns are inserted by calling `JSON.stringify()` and casting with `::jsonb`:

```typescript
// See src/backend/runtime/run-repository.ts lines 248-276
await this.pool.query(
  `INSERT INTO events (..., payload, ..., redaction)
   VALUES ($1, ..., $6::jsonb, ..., $10::jsonb)`,
  [event.run_id, ..., JSON.stringify(event.payload), ..., JSON.stringify(event.redaction)]
);
```

Batch inserts build a dynamic VALUES clause with computed parameter offsets (see `appendEvents` in `src/backend/runtime/run-repository.ts` lines 278-322):

```typescript
const values: string[] = [];
const params: unknown[] = [];
for (const event of events) {
  const offset = params.length;
  values.push(`($${offset + 1}, $${offset + 2}, ...)`);
  params.push(event.run_id, event.ts, ...);
}
await this.pool.query(`INSERT INTO events (...) VALUES ${values.join(',')} RETURNING id::text AS id`, params);
```

Cursor-based pagination uses a monotonic `id` column (see `getRunEvents` in `src/backend/runtime/run-repository.ts` lines 324-368):

```typescript
const result = await this.pool.query<EventRow>(
  `SELECT ... FROM events WHERE run_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3`,
  [run.id, cursorValue, limit]
);
```

Multi-tenant scope filtering is done via a reusable helper `appendScopePredicate` (see `src/backend/runtime/scope.ts` lines 23-36):

```typescript
export function appendScopePredicate(clauses: string[], params: unknown[], scope: ScopeContext): void {
  const orgIndex = params.push(scope.orgId);
  const userIndex = params.push(scope.userId);
  const projectIndex = params.push(scope.projectId);
  clauses.push(`org_id = $${orgIndex}`);
  clauses.push(`user_id = $${userIndex}`);
  clauses.push(`project_id IS NOT DISTINCT FROM $${projectIndex}`);
}
```

---

## Migrations

Schema migrations are defined as an array of idempotent SQL statements in `src/backend/db/schema.ts`. Each statement uses `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, or `DO $$ BEGIN ... END $$` blocks for `ALTER TABLE` operations.

Migrations run at startup via `runPostgresMigrations(pool)` in `src/backend/db/postgres.ts`. A PostgreSQL advisory lock (`pg_advisory_lock`) prevents concurrent migration runs across multiple server instances:

```typescript
await client.query('SELECT pg_advisory_lock($1, $2)', [MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_KEY]);
try {
  for (const statement of POSTGRES_SCHEMA_STATEMENTS) {
    await client.query(statement);
  }
} finally {
  await client.query('SELECT pg_advisory_unlock($1, $2)', [...]);
  client.release();
}
```

When adding new columns to existing tables, use the idempotent `DO $$ BEGIN ... END $$` pattern:

```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'runs' AND column_name = 'group_id'
  ) THEN
    ALTER TABLE runs ADD COLUMN group_id TEXT;
  END IF;
END $$
```

---

## Naming Conventions

- Table names: `snake_case`, plural (e.g., `runs`, `events`, `memories`, `memory_chunks`, `agent_instances`)
- Column names: `snake_case` (e.g., `session_key`, `run_id`, `created_at`)
- Index names: `<table>_<columns>_idx` (e.g., `runs_scope_created_idx`, `events_run_id_idx`)
- Unique indexes: `<table>_<columns>_idx` with `CREATE UNIQUE INDEX`
- Primary keys: `id` column (TEXT for application-generated IDs, BIGSERIAL for auto-increment)
- Foreign keys: `<referenced_table_singular>_id` (e.g., `run_id`, `connector_id`, `memory_id`)
- Timestamps: `TIMESTAMPTZ` type, named `created_at`, `updated_at`, `started_at`, `ended_at`
- Status columns: `TEXT` with `CHECK` constraints (e.g., `status IN ('pending', 'running', 'completed', 'failed', 'cancelled')`)
- JSONB columns: used for flexible/nested data (`payload`, `state`, `config`, `metadata`, `llm_config`)

---

## Common Mistakes

- **String interpolation in SQL**: Never do `` `WHERE id = '${id}'` ``. Always use `$1` placeholders.
- **Forgetting `IS NOT DISTINCT FROM` for nullable columns**: When filtering by `project_id` (which can be NULL), use `project_id IS NOT DISTINCT FROM $N` instead of `project_id = $N` (the latter won't match NULL values).
- **Not releasing clients**: Always use `client.release()` in a `finally` block after `pool.connect()`. The `withTransaction` helper in `src/backend/db/postgres.ts` handles this correctly.
- **Non-idempotent migrations**: Every statement in `POSTGRES_SCHEMA_STATEMENTS` must be safe to run multiple times. Use `IF NOT EXISTS` guards.
- **Casting JSONB**: Remember to cast with `::jsonb` when inserting JSON strings into JSONB columns.
- **BigInt cursor parsing**: Event IDs from Postgres are BIGSERIAL. Parse them with `Number.parseInt(value, 10)` and validate before use (see `castBigintCursor` in `run-repository.ts`).
