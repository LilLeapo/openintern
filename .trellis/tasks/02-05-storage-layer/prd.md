# Implement Storage Layer

## Goal

Implement the foundational storage layer for the Agent System: EventStore, CheckpointStore, MemoryStore, and ProjectionStore.

This is the **first implementation task** - all code will be created from scratch.

---

## Requirements

### 1. EventStore (Priority: P0)

**Purpose**: Append-only event log with JSONL format + indexing for pagination.

**Files**:
- `src/backend/store/event-store.ts`
- `src/backend/store/event-store.test.ts`

**Methods**:
- `append(event: Event): Promise<void>` - Append single event
- `appendBatch(events: Event[]): Promise<void>` - Batch append (atomic)
- `readStream(): AsyncGenerator<Event>` - Stream all events
- `readAll(): Promise<Event[]>` - Read all events
- `readFiltered(predicate): Promise<Event[]>` - Filter events
- `readPage(pageSize, offset): Promise<Event[]>` - Paginated read
- `buildIndex(eventsPerEntry): Promise<void>` - Build `events.idx.jsonl`

**Storage**:
- `data/sessions/<session_key>/runs/<run_id>/events.jsonl` (append-only)
- `data/sessions/<session_key>/runs/<run_id>/events.idx.jsonl` (index for pagination)

**Error handling**:
- Custom `EventStoreError` class
- Validate events before append (using Zod)
- Handle concurrent writes (single-writer principle)

### 2. CheckpointStore (Priority: P0)

**Purpose**: Save/load agent state snapshots for recovery.

**Files**:
- `src/backend/store/checkpoint-store.ts`
- `src/backend/store/checkpoint-store.test.ts`

**Methods**:
- `saveLatest(checkpoint: Checkpoint): Promise<void>` - Save latest checkpoint
- `loadLatest(): Promise<Checkpoint | null>` - Load latest checkpoint
- `saveHistorical(checkpoint, stepId): Promise<void>` - Save historical snapshot

**Storage**:
- `data/sessions/<session_key>/runs/<run_id>/checkpoint.latest.json`
- `data/sessions/<session_key>/runs/<run_id>/checkpoint/<step_id>.json`

### 3. MemoryStore (Priority: P1)

**Purpose**: Store memory items with keyword search (MVP).

**Files**:
- `src/backend/store/memory-store.ts`
- `src/backend/store/memory-store.test.ts`

**Methods**:
- `write(item: MemoryItem): Promise<void>` - Write memory item
- `get(id: string): Promise<MemoryItem | null>` - Get by ID
- `search(query: string, topK: number): Promise<MemoryItem[]>` - Keyword search
- `updateKeywordIndex(item): Promise<void>` - Maintain inverted index (private)

**Storage**:
- `data/memory/shared/items/<memory_id>.json`
- `data/memory/shared/index/keyword.json` (inverted index)

### 4. ProjectionStore (Priority: P1)

**Purpose**: Generate `run.meta.json` from events for fast UI loading.

**Files**:
- `src/backend/store/projection-store.ts`
- `src/backend/store/projection-store.test.ts`

**Methods**:
- `generateRunMeta(runId): Promise<RunMeta>` - Scan events, generate metadata
- `updateRunMeta(event): Promise<void>` - Incremental update on new event
- `loadRunMeta(runId): Promise<RunMeta | null>` - Load cached metadata

**Storage**:
- `data/sessions/<session_key>/runs/<run_id>/projections/run.meta.json`

---

## Acceptance Criteria

### Types & Utils
- [ ] All core types defined in `src/types/` (events.ts, checkpoint.ts, run.ts, memory.ts)
- [ ] Custom error classes in `src/utils/errors.ts`
- [ ] ID generation helpers in `src/utils/ids.ts`
- [ ] Secret redaction in `src/utils/redact.ts`

### EventStore
- [ ] Can append events to `events.jsonl`
- [ ] Can read events as stream
- [ ] Can build `events.idx.jsonl` index
- [ ] Can paginate using index
- [ ] Handles concurrent writes safely (single-writer)
- [ ] All tests pass

### CheckpointStore
- [ ] Can save/load latest checkpoint
- [ ] Can save historical snapshots
- [ ] Returns `null` if checkpoint doesn't exist
- [ ] All tests pass

### MemoryStore
- [ ] Can write/get memory items
- [ ] Can search by keywords (simple substring match for MVP)
- [ ] Maintains keyword.json inverted index
- [ ] All tests pass

### ProjectionStore
- [ ] Can generate run.meta.json from events
- [ ] Can incrementally update metadata
- [ ] All tests pass

### Quality
- [ ] TypeScript strict mode passes (`pnpm typecheck`)
- [ ] ESLint passes (`pnpm lint`)
- [ ] All tests pass (`pnpm test`)
- [ ] No secrets logged

---

## Technical Notes

### Project Setup (Step 1)

Create these config files first:

**package.json**:
```json
{
  "name": "agent-system",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/backend/server.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "test": "vitest"
  },
  "dependencies": {
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0",
    "eslint": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0"
  }
}
```

**tsconfig.json**: Use strict mode (see `spec/frontend/type-safety.md`)

**Directory structure**:
```
src/
├── backend/store/
├── types/
└── utils/
```

### JSONL Format

Every line is a JSON object, newline-separated:

```jsonl
{"v":1,"ts":"2026-02-05T12:00:00.000Z","type":"run.started",...}
{"v":1,"ts":"2026-02-05T12:00:05.123Z","type":"tool.called",...}
```

### Single-Writer Principle

Only one process can write to `events.jsonl` for a given run. Use file locking or process-level locking.

### Testing Strategy

- Use `vitest` with temporary directories
- Clean up test files after each test
- Test error cases (corrupted files, missing directories, etc.)

---

## References

- **Project.md**: Section 3 (Storage Design), Section 12.1 (Implementation Order)
- **Specs**:
  - `spec/backend/directory-structure.md` - File layout
  - `spec/backend/database-guidelines.md` - JSONL patterns
  - `spec/backend/error-handling.md` - Error classes
  - `spec/frontend/type-safety.md` - Core types
