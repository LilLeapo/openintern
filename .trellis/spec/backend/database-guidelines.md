# Database Guidelines

> Storage patterns for this project.

---

## Overview

**This project does NOT use a traditional database.**

Instead, we use **event sourcing with JSONL files** for all persistent state.

**Why no database**:
- Simplicity: No DB setup, migrations, or connection pooling
- Traceability: All events are append-only and immutable
- Portability: Data is just files, easy to backup/inspect
- Event-driven: Natural fit for agent runtime

**Reference**: See backend/directory-structure.md section "Data Directory (Persistent State)".

---

## Storage Architecture

### JSONL Event Store (Primary Storage)

All state is persisted as events in JSONL files:

```
data/
├── sessions/<session_key>/
│   └── runs/<run_id>/
│       ├── events.jsonl               # Append-only event log
│       ├── events.idx.jsonl           # Index for pagination
│       ├── checkpoint.latest.json     # Latest state snapshot
│       └── checkpoint/
│           └── 000001.json            # Historical snapshots
└── memory/
    └── shared/
        ├── items/<memory_id>.json     # Individual memory items
        └── index/
            └── keyword.json           # Keyword inverted index
```

### Why JSONL Instead of Database

| Database | JSONL |
|----------|-------|
| Schema migrations | No migrations needed |
| Connection pooling | Just file I/O |
| Query language (SQL) | Stream processing |
| Indexes & joins | Custom indexes (e.g., keyword.json) |
| ACID transactions | File-level atomicity (append-only) |
| Complex queries | Simple read/filter/map |

**Trade-offs**:
- ✅ Simpler setup and deployment
- ✅ Events are immutable and traceable
- ✅ Easy to debug (just open the file)
- ❌ No complex queries (need to build custom indexes)
- ❌ Performance limits at ~100k events per file (use pagination/sharding)

---

## JSONL Patterns

### Writing Events (Append-Only)

```typescript
// src/backend/store/event-store.ts

export class EventStore {
  constructor(private filePath: string) {}

  async append(event: Event): Promise<void> {
    try {
      const line = JSON.stringify(event) + '\n';
      await fs.promises.appendFile(this.filePath, line, { encoding: 'utf-8' });
    } catch (error) {
      throw new EventStoreError('Failed to append event', {
        filePath: this.filePath,
        eventType: event.type,
      });
    }
  }

  async appendBatch(events: Event[]): Promise<void> {
    const lines = events.map(e => JSON.stringify(e) + '\n').join('');
    await fs.promises.appendFile(this.filePath, lines, { encoding: 'utf-8' });
  }
}
```

**Rules**:
- Never modify existing lines (append-only)
- Always end with `\n` (newline)
- Use `appendFile`, not `writeFile` (prevents overwrites)

### Reading Events (Stream Processing)

```typescript
import readline from 'readline';
import fs from 'fs';

export class EventStore {
  async *readStream(): AsyncGenerator<Event> {
    const fileStream = fs.createReadStream(this.filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        yield event as Event;
      } catch (error) {
        // Log parse error but continue (resilient to corrupted lines)
        logger.warn('Failed to parse event line', { line, error });
      }
    }
  }

  async readAll(): Promise<Event[]> {
    const events: Event[] = [];
    for await (const event of this.readStream()) {
      events.push(event);
    }
    return events;
  }

  async readFiltered(predicate: (event: Event) => boolean): Promise<Event[]> {
    const events: Event[] = [];
    for await (const event of this.readStream()) {
      if (predicate(event)) {
        events.push(event);
      }
    }
    return events;
  }
}
```

**Rules**:
- Use streaming for large files (avoid loading all into memory)
- Handle parse errors gracefully (skip corrupted lines)
- Filter during iteration (don't load everything first)

### Pagination with Index

For large event files, build a lightweight index:

```typescript
// events.idx.jsonl format (one line per N events)
// {"offset": 0, "line": 1, "ts": "2026-02-05T12:00:00Z"}
// {"offset": 1234, "line": 100, "ts": "2026-02-05T12:05:00Z"}

export class EventStore {
  async readPage(pageSize: number = 100, offset: number = 0): Promise<Event[]> {
    const events: Event[] = [];
    let currentLine = 0;

    for await (const event of this.readStream()) {
      if (currentLine >= offset && events.length < pageSize) {
        events.push(event);
      }
      currentLine++;
      if (events.length >= pageSize) break;
    }

    return events;
  }

  async buildIndex(eventsPerEntry: number = 100): Promise<void> {
    const indexPath = this.filePath.replace('.jsonl', '.idx.jsonl');
    const indexStream = fs.createWriteStream(indexPath, { encoding: 'utf-8' });

    let lineNumber = 0;
    let byteOffset = 0;

    for await (const event of this.readStream()) {
      if (lineNumber % eventsPerEntry === 0) {
        const indexEntry = {
          offset: byteOffset,
          line: lineNumber,
          ts: event.ts,
        };
        indexStream.write(JSON.stringify(indexEntry) + '\n');
      }

      const lineSize = Buffer.byteLength(JSON.stringify(event) + '\n', 'utf-8');
      byteOffset += lineSize;
      lineNumber++;
    }

    indexStream.end();
  }
}
```

---

## Checkpoint Snapshots

Checkpoints are **state snapshots** to avoid replaying all events:

```typescript
// src/backend/store/checkpoint-store.ts

export class CheckpointStore {
  constructor(private baseDir: string) {}

  async saveLatest(checkpoint: Checkpoint): Promise<void> {
    const latestPath = path.join(this.baseDir, 'checkpoint.latest.json');
    await fs.promises.writeFile(latestPath, JSON.stringify(checkpoint, null, 2));
  }

  async loadLatest(): Promise<Checkpoint | null> {
    const latestPath = path.join(this.baseDir, 'checkpoint.latest.json');
    try {
      const content = await fs.promises.readFile(latestPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null; // No checkpoint yet
      }
      throw error;
    }
  }

  async saveHistorical(checkpoint: Checkpoint, stepId: string): Promise<void> {
    const histDir = path.join(this.baseDir, 'checkpoint');
    await fs.promises.mkdir(histDir, { recursive: true });

    const filename = `${stepId}.json`;
    const filePath = path.join(histDir, filename);
    await fs.promises.writeFile(filePath, JSON.stringify(checkpoint, null, 2));
  }
}
```

**When to save checkpoints**:
- After every agent step (save latest)
- Every N steps (save historical, e.g., every 10 steps)
- Before critical operations (backup point)

---

## Memory Storage (JSON Files)

Memory items are stored as individual JSON files:

```typescript
// src/backend/store/memory-store.ts

export class MemoryStore {
  constructor(private memoryDir: string) {}

  async write(item: MemoryItem): Promise<void> {
    const itemPath = path.join(this.memoryDir, 'items', `${item.id}.json`);
    await fs.promises.mkdir(path.dirname(itemPath), { recursive: true });
    await fs.promises.writeFile(itemPath, JSON.stringify(item, null, 2));

    // Update keyword index
    await this.updateKeywordIndex(item);
  }

  async get(id: string): Promise<MemoryItem | null> {
    const itemPath = path.join(this.memoryDir, 'items', `${id}.json`);
    try {
      const content = await fs.promises.readFile(itemPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async updateKeywordIndex(item: MemoryItem): Promise<void> {
    const indexPath = path.join(this.memoryDir, 'index', 'keyword.json');

    // Load existing index
    let index: Record<string, string[]> = {};
    try {
      const content = await fs.promises.readFile(indexPath, 'utf-8');
      index = JSON.parse(content);
    } catch (error) {
      // Index doesn't exist yet
    }

    // Extract keywords from item
    const keywords = extractKeywords(item.content);
    for (const keyword of keywords) {
      if (!index[keyword]) {
        index[keyword] = [];
      }
      if (!index[keyword].includes(item.id)) {
        index[keyword].push(item.id);
      }
    }

    // Save updated index
    await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
    await fs.promises.writeFile(indexPath, JSON.stringify(index, null, 2));
  }
}
```

---

## Anti-patterns

### ❌ Don't Modify Existing Events

```typescript
// ❌ Bad: Mutating event log
async function fixEventTypo(runId: string) {
  const events = await eventStore.readAll();
  events[5].type = 'tool.result'; // WRONG: events are immutable
  await fs.promises.writeFile('events.jsonl', events.map(e => JSON.stringify(e)).join('\n'));
}

// ✅ Good: Append correction event
async function fixEventTypo(runId: string) {
  await eventStore.append({
    type: 'run.annotation',
    payload: {
      corrects_event: events[5].span_id,
      correction: 'Event type should be tool.result',
    },
  });
}
```

### ❌ Don't Load Entire File into Memory

```typescript
// ❌ Bad: Loading 100k events at once
const events = await fs.promises.readFile('events.jsonl', 'utf-8')
  .then(content => content.split('\n').map(line => JSON.parse(line)));

// ✅ Good: Stream processing
for await (const event of eventStore.readStream()) {
  if (event.type === 'tool.result') {
    processEvent(event);
  }
}
```

### ❌ Don't Use Sync I/O in Server Code

```typescript
// ❌ Bad: Blocking file I/O
const content = fs.readFileSync('events.jsonl', 'utf-8');

// ✅ Good: Async I/O
const content = await fs.promises.readFile('events.jsonl', 'utf-8');
```

---

## Performance Considerations

### When to Shard Files

If a single JSONL file grows beyond **100MB** or **100k events**:

1. **Option 1: Use index** (recommended for read-heavy)
   - Build `events.idx.jsonl` for fast pagination
   - See "Pagination with Index" above

2. **Option 2: Shard by time** (for write-heavy)
   ```
   data/sessions/s_demo/runs/run_123/
   ├── events.2026-02-05.jsonl
   ├── events.2026-02-06.jsonl
   └── events.2026-02-07.jsonl
   ```

3. **Option 3: Compact old runs** (archive)
   - Create `trace.compact.json` projection
   - Move original `events.jsonl` to archive directory

### Caching Strategy

```typescript
export class CachedEventStore {
  private cache = new Map<string, Event[]>();

  async readAll(): Promise<Event[]> {
    const cacheKey = this.filePath;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const events = await super.readAll();
    this.cache.set(cacheKey, events);
    return events;
  }

  invalidateCache(): void {
    this.cache.clear();
  }
}
```

**Use caching for**:
- Completed runs (immutable)
- Index files (rarely change)

**Don't cache**:
- Active runs (frequently updated)

---

## Verification

### Check File Integrity

```bash
# Check for malformed JSON lines
while IFS= read -r line; do
  echo "$line" | jq empty || echo "Invalid JSON: $line"
done < data/sessions/s_demo/runs/run_123/events.jsonl

# Count events
wc -l data/sessions/s_demo/runs/run_123/events.jsonl

# Verify all events have required fields
jq -r 'select(.v == null or .ts == null or .type == null) | "Missing field: " + input_filename' \
  data/sessions/s_demo/runs/run_123/events.jsonl
```

### Test Event Store

```typescript
// src/backend/store/event-store.test.ts
describe('EventStore', () => {
  it('should handle concurrent appends', async () => {
    const store = new EventStore('/tmp/test.jsonl');
    const events = Array.from({ length: 100 }, (_, i) => createEvent(i));

    await Promise.all(events.map(e => store.append(e)));

    const saved = await store.readAll();
    expect(saved).toHaveLength(100);
  });

  it('should skip corrupted lines gracefully', async () => {
    await fs.promises.writeFile('/tmp/test.jsonl',
      '{"valid": true}\n' +
      'invalid json\n' +
      '{"valid": true}\n'
    );

    const events = await store.readAll();
    expect(events).toHaveLength(2); // Skipped corrupted line
  });
});
```

---

## Migration Guide

**If you need to add a database later**:

1. Keep events.jsonl as source of truth
2. Add DB as read-optimized projection
3. Build projection by replaying events:

```typescript
async function rebuildProjection() {
  await db.truncate('runs');

  for await (const event of eventStore.readStream()) {
    await updateProjection(event); // Idempotent update
  }
}
```

This way, DB can always be rebuilt from events.

---

## Related Specs

- [Directory Structure](./directory-structure.md) - Data directory layout
- [Error Handling](./error-handling.md) - Error event format
- [Quality Guidelines](./quality-guidelines.md) - File I/O patterns
