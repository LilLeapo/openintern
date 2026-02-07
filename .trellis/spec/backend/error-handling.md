# Error Handling

> How errors are handled in the TS+Python Agent System.

---

## Overview

This project uses **event-driven error handling**:
- All errors are recorded as events in `events.jsonl`
- API errors follow a standard JSON format
- Python tools return errors via MCP protocol
- Secrets are redacted before logging

**Key principles**:
- Fail fast, recover gracefully
- All errors are traceable via events
- User-facing errors are sanitized
- Internal errors include full context

**Reference**: Project.md sections 3.2 (event format), 9 (security/redaction).

---

## Error Types

### TypeScript Error Classes

Define custom error classes extending `Error`:

```typescript
// src/utils/errors.ts

export class AgentError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export class EventStoreError extends AgentError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'EVENT_STORE_ERROR', 500, details);
    this.name = 'EventStoreError';
  }
}

export class ToolError extends AgentError {
  constructor(
    message: string,
    public toolName: string,
    details?: Record<string, any>
  ) {
    super(message, 'TOOL_ERROR', 500, details);
    this.name = 'ToolError';
  }
}

export class ValidationError extends AgentError {
  constructor(message: string, public field: string) {
    super(message, 'VALIDATION_ERROR', 400, { field });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AgentError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404, { resource, id });
    this.name = 'NotFoundError';
  }
}
```

### Python Error Handling (MCP Tools)

Python tools should return errors via MCP protocol:

```python
# skills/memory_skill/tools/memory_search.py

def memory_search(query: str, top_k: int = 5) -> dict:
    """Search memory items (returns MCP-compatible result)."""
    try:
        results = search_implementation(query, top_k)
        return {
            "content": [{"type": "text", "text": json.dumps(results)}],
            "isError": False
        }
    except ValueError as e:
        # User error (bad input)
        return {
            "content": [{"type": "text", "text": str(e)}],
            "isError": True
        }
    except Exception as e:
        # System error (log full context, return sanitized message)
        logger.error("Memory search failed", exc_info=True, extra={"query": query})
        return {
            "content": [{"type": "text", "text": "Search failed due to internal error"}],
            "isError": True
        }
```

---

## Error Events (JSONL Format)

All errors must be recorded as events:

```typescript
// Event type: run.failed
{
  "v": 1,
  "ts": "2026-02-05T12:34:56.789Z",
  "session_key": "s_demo",
  "run_id": "run_123",
  "agent_id": "main",
  "step_id": "step_0007",
  "type": "run.failed",
  "span_id": "sp_abc",
  "parent_span_id": null,
  "payload": {
    "error": {
      "code": "TOOL_ERROR",
      "message": "Memory search failed",
      "toolName": "memory_search",
      "details": {
        "reason": "Index file corrupted"
      }
    }
  },
  "redaction": {
    "contains_secrets": false
  }
}

// Event type: tool.result (error case)
{
  "v": 1,
  "ts": "2026-02-05T12:34:56.789Z",
  "session_key": "s_demo",
  "run_id": "run_123",
  "agent_id": "main",
  "step_id": "step_0007",
  "type": "tool.result",
  "span_id": "sp_tool_123",
  "parent_span_id": "sp_abc",
  "payload": {
    "toolName": "memory_search",
    "isError": true,
    "error": {
      "message": "Search failed due to internal error",
      "code": "INTERNAL_ERROR"
    }
  },
  "redaction": {
    "contains_secrets": false
  }
}
```

---

## Error Handling Patterns

### TypeScript Patterns

#### Pattern 1: Try-Catch with Event Recording

```typescript
// src/backend/agent/loop.ts

async step(input: string): Promise<void> {
  try {
    // Business logic
    const result = await this.toolRouter.call('memory_search', { query: input });
    await this.eventStore.append({
      type: 'tool.result',
      payload: { result }
    });
  } catch (error) {
    // Record error event
    await this.eventStore.append({
      type: 'tool.result',
      payload: {
        isError: true,
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          code: error instanceof AgentError ? error.code : 'UNKNOWN_ERROR'
        }
      },
      redaction: { contains_secrets: false }
    });

    // Re-throw for caller to handle
    throw error;
  }
}
```

#### Pattern 2: Error Transformation

```typescript
// src/backend/store/event-store.ts

async append(event: Event): Promise<void> {
  try {
    await fs.promises.appendFile(
      this.filePath,
      JSON.stringify(event) + '\n',
      { encoding: 'utf-8' }
    );
  } catch (error) {
    // Transform to domain error
    throw new EventStoreError(
      'Failed to append event',
      {
        filePath: this.filePath,
        eventType: event.type,
        originalError: error instanceof Error ? error.message : String(error)
      }
    );
  }
}
```

#### Pattern 3: Async Error Boundary

```typescript
// src/backend/api/runs.ts

app.post('/api/runs', asyncHandler(async (req, res) => {
  const run = await runService.create(req.body);
  res.json(run);
}));

// Utility wrapper
function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AgentError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details
      }
    });
  } else {
    logger.error('Unhandled error', { error: err });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred'
      }
    });
  }
});
```

### Python Patterns (from .claude/hooks/)

Based on existing hooks:

```python
# Pattern: Try-except with early return

def main():
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        # Fail gracefully: allow operation to proceed
        sys.exit(0)

    try:
        result = process_data(input_data)
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0)
    except ValueError as e:
        # User error: block operation
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        # System error: log and fail
        print(json.dumps({"error": "Internal error"}), file=sys.stderr)
        sys.exit(1)
```

---

## API Error Responses

### Standard Error Response Format

```typescript
{
  "error": {
    "code": "ERROR_CODE",           // Machine-readable code
    "message": "Human-readable message",
    "details"?: {                   // Optional context
      "field": "value"
    },
    "trace_id"?: "run_123"          // For traceability
  }
}
```

### HTTP Status Codes

| Status | Error Type | When to Use |
|--------|------------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid input, missing required fields |
| 404 | `NOT_FOUND` | Resource doesn't exist |
| 409 | `CONFLICT` | Resource already exists, state conflict |
| 422 | `UNPROCESSABLE_ENTITY` | Valid syntax but semantic error |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 503 | `SERVICE_UNAVAILABLE` | MCP server down, external dependency unavailable |

### Examples

```typescript
// 400 Validation Error
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid session_key format",
    "details": {
      "field": "session_key",
      "expected": "s_<alphanumeric>"
    }
  }
}

// 404 Not Found
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Run not found: run_123",
    "details": {
      "resource": "run",
      "id": "run_123"
    }
  }
}

// 500 Internal Error
{
  "error": {
    "code": "EVENT_STORE_ERROR",
    "message": "Failed to read events",
    "trace_id": "run_123"
  }
}
```

---

## Secret Redaction

**CRITICAL**: Never log secrets in events or error messages.

```typescript
// src/utils/redact.ts

const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /token/i,
  /password/i,
  /secret/i,
  /bearer\s+\S+/i,
];

export function redactSecrets(obj: any): { redacted: any; containsSecrets: boolean } {
  let containsSecrets = false;

  const redacted = JSON.parse(JSON.stringify(obj), (key, value) => {
    if (typeof value === 'string' && SECRET_PATTERNS.some(p => p.test(key))) {
      containsSecrets = true;
      return '[REDACTED]';
    }
    return value;
  });

  return { redacted, containsSecrets };
}

// Usage
const { redacted, containsSecrets } = redactSecrets(toolResult);
await eventStore.append({
  type: 'tool.result',
  payload: redacted,
  redaction: { contains_secrets: containsSecrets }
});
```

---

## Anti-patterns

### ❌ Don't Swallow Errors Silently

```typescript
// ❌ Bad: Silent failure
try {
  await riskyOperation();
} catch (e) {
  // Nothing - error disappears
}

// ✅ Good: At minimum, log it
try {
  await riskyOperation();
} catch (e) {
  logger.error('Risky operation failed', { error: e });
  throw e; // or handle appropriately
}
```

### ❌ Don't Return Different Error Shapes

```typescript
// ❌ Bad: Inconsistent error responses
app.get('/api/runs/:id', (req, res) => {
  if (!req.params.id) {
    return res.status(400).send('Missing ID'); // String
  }
  if (!run) {
    return res.status(404).json({ message: 'Not found' }); // Different shape
  }
});

// ✅ Good: Always use standard format
app.get('/api/runs/:id', (req, res) => {
  if (!req.params.id) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Missing ID' }
    });
  }
  if (!run) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Run not found' }
    });
  }
});
```

### ❌ Don't Log Secrets

```typescript
// ❌ Bad: Logging sensitive data
logger.error('API call failed', { apiKey: user.apiKey });

// ✅ Good: Redact first
const { redacted } = redactSecrets({ apiKey: user.apiKey });
logger.error('API call failed', redacted);
```

---

## Verification

### Check Error Events

```bash
# Verify all errors are recorded as events
grep '"type": "run.failed"' data/sessions/*/runs/*/events.jsonl

# Check for leaked secrets
grep -i 'api_key.*["\047]sk-' data/sessions/*/runs/*/events.jsonl
# (Should return nothing)
```

### Test Error Responses

```bash
# 400 Bad Request
curl -X POST http://localhost:3000/api/runs \
  -H 'Content-Type: application/json' \
  -d '{"invalid": "data"}'

# Should return { "error": { "code": "...", "message": "..." } }
```

---

## Related Specs

- [Logging Guidelines](./logging-guidelines.md) - Structured logging format
- [Quality Guidelines](./quality-guidelines.md) - Error handling lints
- [Type Safety](../frontend/type-safety.md) - Error type definitions
