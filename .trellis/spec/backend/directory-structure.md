# Backend Directory Structure

> Module organization and file layout for the TS+Python Agent System.

---

## Overview

This project uses **event sourcing with JSONL** (no database) and separates TypeScript runtime from Python skills via MCP.

**Key principles**:
- TypeScript handles runtime, storage, API, and UI
- Python provides tools via MCP servers
- All state persists in JSONL files (no database)
- Clear separation: `src/` (TS), `skills/` (Python), `data/` (persistent state)

---

## Directory Layout

### TypeScript Backend (Node.js)

```
src/
├── backend/                           # Backend + Agent Runtime
│   ├── agent/                         # Agent runtime core
│   │   ├── loop.ts                    # Agent Loop state machine
│   │   ├── context-manager.ts         # Context management (token budget, pruning)
│   │   └── tool-router.ts             # Tool routing (MCP + local)
│   ├── store/                         # Storage layer (no DB)
│   │   ├── event-store.ts             # JSONL append/read with index
│   │   ├── checkpoint-store.ts        # Checkpoint save/load
│   │   ├── memory-store.ts            # Memory items storage
│   │   └── projection-store.ts        # Generate projections from events
│   ├── api/                           # REST API endpoints
│   │   ├── runs.ts                    # Runs CRUD + stream
│   │   ├── sessions.ts                # Sessions management
│   │   └── memory.ts                  # Memory search/get
│   ├── mcp/                           # MCP integration
│   │   ├── client.ts                  # MCP client (stdio/HTTP)
│   │   └── types.ts                   # MCP protocol types
│   └── server.ts                      # Express server entry
├── web/                               # React Web UI
│   ├── pages/
│   │   ├── chat/                      # Chat page
│   │   └── trace/                     # Trace viewer page
│   └── components/
│       ├── chat/                      # Chat components
│       ├── trace/                     # Trace components
│       └── common/                    # Shared components
├── cli/                               # CLI tool
│   ├── commands/
│   │   ├── dev.ts                     # Start dev server
│   │   ├── run.ts                     # Create run
│   │   ├── tail.ts                    # Stream events
│   │   └── export.ts                  # Export trace
│   └── index.ts                       # CLI entry
├── types/                             # Shared TypeScript types
│   ├── events.ts                      # Event type definitions
│   ├── checkpoint.ts                  # Checkpoint structure
│   ├── run.ts                         # Run metadata
│   └── tools.ts                       # Tool definitions
└── utils/                             # Utility functions
    ├── logger.ts                      # Structured logging
    ├── redact.ts                      # Secret redaction
    └── ids.ts                         # ID generation
```

### Python Skills (MCP Servers)

```
skills/
├── memory_skill/                      # Memory tools
│   ├── manifest.json                  # MCP server manifest
│   ├── server.py                      # MCP server entry
│   └── tools/
│       ├── memory_search.py           # Keyword/semantic search
│       ├── memory_get.py              # Get by ID
│       └── memory_write.py            # Write structured item
├── python_exec_skill/                 # (Optional) Python execution
│   ├── manifest.json
│   ├── server.py
│   └── tools/
│       └── exec.py                    # Sandboxed execution
└── README.md                          # Skills overview
```

### Data Directory (Persistent State)

```
data/
├── sessions/<session_key>/
│   └── runs/<run_id>/
│       ├── events.jsonl               # Event source (append-only)
│       ├── events.idx.jsonl           # Index for pagination
│       ├── checkpoint.latest.json     # Latest state snapshot
│       ├── checkpoint/
│       │   └── 000001.json            # Historical snapshots
│       └── projections/
│           ├── run.meta.json          # Run metadata (title, status, stats)
│           └── trace.compact.json     # Compact trace for UI
└── memory/
    └── shared/
        ├── items/<memory_id>.json     # Individual memory items
        └── index/
            ├── keyword.json           # Keyword inverted index (MVP)
            └── vectors.*              # Vector index (reserved)
```

**Reference**: See Project.md sections 3.1 (directory structure) and 12 (implementation order).

---

## Module Organization

### TypeScript Modules

1. **One export per file** for main classes/functions
   - Example: `event-store.ts` exports `EventStore` class
   - Example: `logger.ts` exports `createLogger` function

2. **Group related utilities**
   - `utils/ids.ts` contains all ID generation functions
   - `utils/redact.ts` contains all secret redaction logic

3. **Co-locate types with implementation**
   - `backend/store/event-store.ts` + `types/events.ts`
   - Keep core type definitions in `types/`, implementation-specific types inline

4. **Use barrel exports sparingly**
   - Only for `types/index.ts` to re-export common types
   - Avoid index files elsewhere (they hide dependencies)

### Python Modules

1. **One tool per file** in `tools/` directory
   - `tools/memory_search.py` - Single tool implementation
   - `tools/memory_get.py` - Another tool

2. **Fixed naming for MCP**
   - Server entry: always `server.py`
   - Manifest: always `manifest.json`

3. **Explicit imports preferred**
   - Use `__init__.py` only when creating a proper package
   - Otherwise, prefer explicit imports

---

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| TypeScript files | `kebab-case.ts` | `event-store.ts`, `context-manager.ts` |
| React components | `PascalCase.tsx` | `ChatPage.tsx`, `TraceViewer.tsx` |
| Python files | `snake_case.py` | `memory_search.py`, `server.py` |
| Type definitions | `kebab-case.ts` in `types/` | `types/events.ts` |
| Config files | Lowercase | `manifest.json`, `tsconfig.json` |
| Classes (TS) | `PascalCase` | `EventStore`, `AgentLoop` |
| Functions (TS) | `camelCase` | `createLogger`, `generateId` |
| Functions (Python) | `snake_case` | `memory_search`, `load_events` |
| Constants (all) | `UPPER_SNAKE_CASE` | `MAX_ITERATIONS`, `DEFAULT_TIMEOUT` |

---

## Import Path Rules

### TypeScript

```typescript
// ✅ Good: Absolute imports from src/
import { EventStore } from '@/backend/store/event-store';
import { Event } from '@/types/events';

// ❌ Bad: Relative imports crossing module boundaries
import { EventStore } from '../../backend/store/event-store';
```

**Setup**: Configure `tsconfig.json` with `paths`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

### Python

```python
# ✅ Good: Absolute imports from package root
from memory_skill.tools.memory_search import search

# ✅ Good: Relative imports within package
from .tools.memory_search import search

# ❌ Bad: Sys.path hacks
import sys; sys.path.append('..')
```

---

## Anti-patterns

### ❌ Don't Mix Storage Logic with Business Logic

```typescript
// ❌ Bad: Agent loop directly writes JSONL
class AgentLoop {
  async step() {
    fs.appendFileSync('events.jsonl', JSON.stringify(event));
  }
}

// ✅ Good: Use EventStore abstraction
class AgentLoop {
  constructor(private eventStore: EventStore) {}
  async step() {
    await this.eventStore.append(event);
  }
}
```

### ❌ Don't Create Deep Nesting (Max 3 levels)

```
❌ src/backend/agent/tools/handlers/memory/search.ts  (5 levels)
✅ src/backend/agent/tool-router.ts                    (3 levels)
✅ src/backend/store/event-store.ts                    (3 levels)
```

**Reason**: Deep nesting makes imports long and modules hard to find.

### ❌ Don't Put Business Logic in API Routes

```typescript
// ❌ Bad: Business logic in route
app.post('/api/runs', async (req, res) => {
  const event = { /* ... */ };
  fs.appendFileSync('events.jsonl', JSON.stringify(event));
  // ... 50 lines of agent logic
});

// ✅ Good: Thin API layer
app.post('/api/runs', async (req, res) => {
  const run = await runService.create(req.body);
  res.json(run);
});
```

**Reason**: Routes should only handle HTTP concerns (parsing, validation, response).

---

## Verification

### Check Structure

```bash
# Check TypeScript structure
tree src/ -L 3

# Check Python structure
tree skills/ -L 3

# Check data directory exists
mkdir -p data/sessions data/memory/shared/items
```

### Lint Import Paths

```bash
# ESLint rule: no relative imports across modules
pnpm eslint --rule 'import/no-relative-packages: error'
```

---

## Related Specs

- [Error Handling](./error-handling.md) - Event error format
- [Logging Guidelines](./logging-guidelines.md) - Structured logging
- [Quality Guidelines](./quality-guidelines.md) - Code style
