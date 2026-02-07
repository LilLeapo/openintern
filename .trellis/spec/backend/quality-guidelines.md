# Backend Quality Guidelines

> Code quality standards and best practices for backend development.

---

## Overview

This project follows **strict code quality standards** with automated enforcement through linting and type checking.

**Key principles**:
- TypeScript strict mode enabled
- No-any policy (except documented exceptions)
- All functions have clear contracts
- Consistent error handling patterns
- Python code follows PEP 8 + type hints

**Reference**: Based on patterns in backend/error-handling.md and Python hooks in `.claude/hooks/`.

---

## Code Style

### TypeScript Style

**Formatting**: Use Prettier with default config

```bash
pnpm add -D prettier
```

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "tabWidth": 2,
  "printWidth": 100
}
```

**Linting**: ESLint with TypeScript plugin

```json
// .eslintrc.json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-function-return-type": ["warn", {
      "allowExpressions": true
    }],
    "no-console": ["warn", { "allow": ["warn", "error"] }]
  }
}
```

### Python Style

**Formatting**: Black + isort

```bash
pip install black isort
```

```python
# pyproject.toml
[tool.black]
line-length = 100
target-version = ['py311']

[tool.isort]
profile = "black"
line_length = 100
```

**Type hints**: Required for all functions

```python
# ✅ Good: Complete type hints
def process_events(file_path: str, limit: int = 100) -> list[dict]:
    """Process events from JSONL file."""
    events: list[dict] = []
    # ...
    return events

# ❌ Bad: No type hints
def process_events(file_path, limit=100):
    events = []
    # ...
    return events
```

**Docstrings**: Required for public functions (Google style)

```python
def memory_search(query: str, top_k: int = 5) -> dict:
    """Search memory items by keyword.

    Args:
        query: Search query string
        top_k: Maximum number of results to return

    Returns:
        MCP-compatible result dict with content and isError fields

    Raises:
        ValueError: If query is empty or top_k is invalid
    """
    pass
```

---

## Forbidden Patterns

### ❌ Don't Use `any` Without Documentation

```typescript
// ❌ Bad: Silent type escape
function processData(data: any) {
  return data.value;
}

// ✅ Good: Use proper types
interface Data {
  value: string;
}
function processData(data: Data) {
  return data.value;
}

// ✅ Acceptable: External library (documented)
// TODO: Add types for externalLib
const result = externalLib.getData() as any;
```

### ❌ Don't Mix Concerns in Single Function

```typescript
// ❌ Bad: Mixed I/O, parsing, and business logic
async function createRun(req: Request): Promise<void> {
  const body = req.body;
  const sessionKey = body.session_key;
  const events: Event[] = [];
  fs.appendFileSync('events.jsonl', JSON.stringify(events));
  // ... 50 more lines
}

// ✅ Good: Separated concerns
async function createRun(req: Request): Promise<void> {
  const data = parseCreateRunRequest(req.body);
  const run = await runService.create(data);
  return run;
}
```

### ❌ Don't Silently Ignore Errors

```python
# ❌ Bad: Swallowed error
try:
    result = risky_operation()
except Exception:
    pass  # Error disappears

# ✅ Good: At minimum, log it
try:
    result = risky_operation()
except Exception as e:
    logger.error("Operation failed", exc_info=True)
    raise
```

### ❌ Don't Use Magic Numbers/Strings

```typescript
// ❌ Bad: Magic values
if (retryCount > 3) {
  setTimeout(() => retry(), 5000);
}

// ✅ Good: Named constants
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

if (retryCount > MAX_RETRIES) {
  setTimeout(() => retry(), RETRY_DELAY_MS);
}
```

---

## Required Patterns

### ✅ Always Validate External Input

```typescript
// Use Zod for API boundaries
import { z } from 'zod';

const CreateRunSchema = z.object({
  session_key: z.string().regex(/^s_[a-zA-Z0-9_]+$/),
  input: z.string().min(1).max(10000),
});

app.post('/api/runs', async (req, res) => {
  const data = CreateRunSchema.parse(req.body); // Throws if invalid
  // ...
});
```

### ✅ Always Use Structured Logging

```typescript
// ❌ Bad: Unstructured console.log
console.log('Run created: ' + runId);

// ✅ Good: Structured logger with context
logger.info('Run created', {
  runId,
  sessionKey,
  agentId,
});
```

### ✅ Always Handle Async Errors

```typescript
// ✅ Wrap async route handlers
app.post('/api/runs', asyncHandler(async (req, res) => {
  // Errors automatically caught and passed to error middleware
  const run = await runService.create(req.body);
  res.json(run);
}));

function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
```

### ✅ Always Use Early Returns

```typescript
// ❌ Bad: Deep nesting
function processEvent(event: Event) {
  if (event.type === 'run.started') {
    if (event.payload.input) {
      if (isValid(event.payload.input)) {
        return doSomething();
      }
    }
  }
}

// ✅ Good: Early returns
function processEvent(event: Event) {
  if (event.type !== 'run.started') return;
  if (!event.payload.input) return;
  if (!isValid(event.payload.input)) return;

  return doSomething();
}
```

---

## Function Size and Complexity

### Max Function Length

- **TypeScript**: 50 lines (excluding types/comments)
- **Python**: 40 lines (excluding docstrings)
- If longer, split into helper functions

### Max Cyclomatic Complexity

- **Limit**: 10 (max 10 decision points per function)
- Use early returns to reduce nesting
- Extract complex conditions into named functions

```typescript
// ❌ Bad: High complexity
function shouldRetry(error: Error, retryCount: number, config: Config) {
  if (error instanceof NetworkError &&
      retryCount < config.maxRetries &&
      config.retryEnabled &&
      !error.isFatal) {
    return true;
  }
  return false;
}

// ✅ Good: Extracted conditions
function shouldRetry(error: Error, retryCount: number, config: Config): boolean {
  return (
    isRetryableError(error) &&
    hasRetriesLeft(retryCount, config) &&
    config.retryEnabled
  );
}

function isRetryableError(error: Error): boolean {
  return error instanceof NetworkError && !error.isFatal;
}

function hasRetriesLeft(count: number, config: Config): boolean {
  return count < config.maxRetries;
}
```

---

## Testing Requirements

### Unit Tests

**Coverage target**: 80% for business logic

```typescript
// src/backend/store/event-store.test.ts
import { EventStore } from './event-store';

describe('EventStore', () => {
  it('should append event to JSONL file', async () => {
    const store = new EventStore('/tmp/test.jsonl');
    const event = createTestEvent();

    await store.append(event);

    const events = await store.readAll();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(event);
  });

  it('should throw EventStoreError if file write fails', async () => {
    const store = new EventStore('/invalid/path.jsonl');
    const event = createTestEvent();

    await expect(store.append(event)).rejects.toThrow(EventStoreError);
  });
});
```

### Integration Tests

**For**: API endpoints, MCP client, storage layer

```typescript
// src/backend/api/runs.test.ts
import request from 'supertest';
import { app } from '../server';

describe('POST /api/runs', () => {
  it('should create run and return metadata', async () => {
    const response = await request(app)
      .post('/api/runs')
      .send({
        session_key: 's_test',
        input: 'Hello world',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      run_id: expect.stringMatching(/^run_/),
      status: 'pending',
    });
  });
});
```

### Test Organization

```
src/
├── backend/
│   ├── store/
│   │   ├── event-store.ts
│   │   └── event-store.test.ts       # Co-located unit tests
│   └── api/
│       ├── runs.ts
│       └── runs.test.ts
└── __tests__/
    └── integration/                   # Integration tests
        └── api.test.ts
```

---

## Code Review Checklist

### Before Submitting PR

- [ ] All tests pass (`pnpm test`)
- [ ] No TypeScript errors (`pnpm tsc --noEmit`)
- [ ] No linting errors (`pnpm eslint .`)
- [ ] Python code formatted (`black . && isort .`)
- [ ] No secrets in code or events
- [ ] Updated relevant documentation

### During Review

**Type Safety**
- [ ] No `any` without justification
- [ ] Zod validation at API boundaries
- [ ] Type guards used correctly

**Error Handling**
- [ ] All errors recorded as events
- [ ] Secrets redacted before logging
- [ ] Meaningful error messages

**Code Quality**
- [ ] Functions under 50 lines
- [ ] Clear naming (no `data`, `temp`, `x`)
- [ ] No duplicated logic
- [ ] Early returns used

**Testing**
- [ ] Edge cases covered
- [ ] Error paths tested
- [ ] No flaky tests

---

## Verification

### Run All Checks

```bash
# TypeScript
pnpm tsc --noEmit        # Type check
pnpm eslint .            # Lint
pnpm prettier --check .  # Format check
pnpm test                # Tests

# Python
black --check .          # Format check
isort --check .          # Import order check
mypy skills/             # Type check
pytest skills/           # Tests (if any)
```

### Pre-commit Hook

```bash
# .husky/pre-commit
#!/bin/sh
pnpm tsc --noEmit || exit 1
pnpm eslint . || exit 1
black --check . || exit 1
```

---

## Related Specs

- [Error Handling](./error-handling.md) - Error patterns
- [Type Safety](../frontend/type-safety.md) - Type definitions
- [Logging Guidelines](./logging-guidelines.md) - Structured logging
