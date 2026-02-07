# Logging Guidelines

> Structured logging patterns for the Agent System.

---

## Overview

This project uses **dual logging**:
1. **Structured logs** (stdout/stderr) for operations and debugging
2. **Event logs** (`events.jsonl`) for traceability and replay

**Key principles**:
- All logs are structured JSON (machine-readable)
- Events are the source of truth (logs are auxiliary)
- Never log secrets or PII
- Logs include context for distributed tracing

**Reference**: Project.md section 3.2 (events) and existing Python hooks logging patterns.

---

## Logging Library

### TypeScript: Winston

```bash
pnpm add winston
```

```typescript
// src/utils/logger.ts

import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'ISO' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
          return `${timestamp} [${level}] ${message} ${metaStr}`;
        })
      )
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error'
    }),
    new winston.transports.File({
      filename: 'logs/combined.log'
    })
  ]
});
```

### Python: Standard logging

Based on existing hooks pattern:

```python
# skills/memory_skill/utils/logger.py

import logging
import json
import sys

def setup_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter(
        '%(asctime)s [%(levelname)s] %(name)s: %(message)s'
    ))
    logger.addHandler(handler)

    return logger

# Usage
logger = setup_logger(__name__)
logger.info("Memory search completed", extra={"query": query, "results": len(results)})
```

---

## Log Levels

| Level | When to Use | Examples |
|-------|-------------|----------|
| **ERROR** | Operation failed, needs attention | Event write failed, MCP server unreachable, tool timeout |
| **WARN** | Recoverable issue, potential problem | Tool returned partial results, checkpoint save skipped, rate limit approaching |
| **INFO** | Important business events | Run started/completed, tool called, checkpoint saved |
| **DEBUG** | Detailed execution flow | Context pruning details, retry attempts, cache hits |

### Level Guidelines

#### ERROR
- Always log stack trace
- Include context for debugging
- Alert-worthy issues

```typescript
logger.error('Failed to append event', {
  error: err.message,
  stack: err.stack,
  run_id: 'run_123',
  event_type: 'tool.called'
});
```

#### WARN
- Degraded functionality but system continues
- Edge cases that should be rare

```typescript
logger.warn('Checkpoint save skipped', {
  reason: 'No state changes since last checkpoint',
  run_id: 'run_123',
  step_id: 'step_0007'
});
```

#### INFO
- Normal significant events
- Helps understand system behavior

```typescript
logger.info('Run completed', {
  run_id: 'run_123',
  duration_ms: 45000,
  steps: 12,
  tool_calls: 8
});
```

#### DEBUG
- Verbose details for troubleshooting
- Not shown in production by default

```typescript
logger.debug('Context pruned', {
  before_tokens: 15000,
  after_tokens: 8000,
  messages_removed: 5
});
```

---

## Structured Logging Format

### Required Fields

All logs must include:

```typescript
{
  "timestamp": "2026-02-05T12:34:56.789Z",  // ISO 8601
  "level": "info",                          // error | warn | info | debug
  "message": "Human-readable message",      // Brief description
  "service": "agent-runtime",               // Component name
  ...contextFields                          // Additional context
}
```

### Context Fields

Include relevant IDs for tracing:

```typescript
{
  "session_key": "s_demo",
  "run_id": "run_123",
  "step_id": "step_0007",
  "agent_id": "main",
  "span_id": "sp_abc"          // For distributed tracing
}
```

### Example Logs

```json
{
  "timestamp": "2026-02-05T12:34:56.789Z",
  "level": "info",
  "message": "Tool called successfully",
  "service": "tool-router",
  "run_id": "run_123",
  "step_id": "step_0007",
  "toolName": "memory_search",
  "duration_ms": 145
}

{
  "timestamp": "2026-02-05T12:34:57.123Z",
  "level": "error",
  "message": "Failed to read events file",
  "service": "event-store",
  "error": "ENOENT: no such file or directory",
  "filePath": "data/sessions/s_demo/runs/run_123/events.jsonl",
  "run_id": "run_123"
}
```

---

## What to Log

### TypeScript

#### System Lifecycle
```typescript
logger.info('Server starting', { port: 3000 });
logger.info('MCP client connected', { server_id: 'memory_skill' });
logger.warn('Graceful shutdown initiated', { active_runs: 3 });
```

#### Run Lifecycle (also in events.jsonl)
```typescript
logger.info('Run started', { run_id, session_key, input_length: input.length });
logger.info('Run completed', { run_id, duration_ms, steps, tool_calls });
logger.error('Run failed', { run_id, error: err.message, step_id });
```

#### Tool Calls
```typescript
logger.info('Tool called', { run_id, step_id, toolName, args: redact(args) });
logger.info('Tool result', { run_id, toolName, duration_ms });
logger.error('Tool timeout', { run_id, toolName, timeout_ms });
```

#### Storage Operations
```typescript
logger.debug('Event appended', { run_id, event_type, byte_offset });
logger.warn('Checkpoint save failed', { run_id, reason: err.message });
```

### Python (MCP Tools)

Based on existing hooks pattern:

```python
# Operation start/end
logger.info("Memory search started", extra={"query": query, "top_k": top_k})
logger.info("Memory search completed", extra={"results_count": len(results), "duration_ms": duration})

# Errors
logger.error("Memory search failed", exc_info=True, extra={"query": query})

# Warnings
logger.warning("Using fallback keyword search", extra={"reason": "vector index not found"})
```

---

## What NOT to Log

### ❌ Secrets and Credentials

```typescript
// ❌ Bad: Leaking API key
logger.info('Calling external API', { api_key: user.api_key });

// ✅ Good: Redacted
logger.info('Calling external API', { api_key_hash: hash(user.api_key) });
```

### ❌ PII (Personally Identifiable Information)

```typescript
// ❌ Bad: Leaking user data
logger.info('User input', { email: user.email, name: user.name });

// ✅ Good: Aggregated or hashed
logger.info('User input', { user_id_hash: hash(user.id), input_length: input.length });
```

### ❌ Large Payloads

```typescript
// ❌ Bad: Flooding logs
logger.info('Tool result', { result: largeObject }); // 10MB object

// ✅ Good: Summary only
logger.info('Tool result', {
  result_type: typeof largeObject,
  result_size_bytes: JSON.stringify(largeObject).length,
  result_keys: Object.keys(largeObject)
});
```

### ❌ High-frequency Debug Logs in Production

```typescript
// ❌ Bad: Log on every token (floods logs)
for (const token of tokens) {
  logger.debug('Token processed', { token });
}

// ✅ Good: Aggregate
logger.debug('Tokens processed', { count: tokens.length });
```

---

## Redaction Helpers

### TypeScript

```typescript
// src/utils/redact.ts

const REDACT_KEYS = new Set([
  'api_key', 'apiKey', 'token', 'password', 'secret',
  'bearer', 'authorization', 'cookie'
]);

export function redact(obj: any): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redact);
  }

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACT_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      result[key] = redact(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// Usage
logger.info('Tool called', redact({ toolName: 'api_call', args: { api_key: 'sk-...' } }));
// => { "toolName": "api_call", "args": { "api_key": "[REDACTED]" } }
```

### Python

```python
# skills/utils/redact.py

REDACT_KEYS = {'api_key', 'token', 'password', 'secret', 'bearer'}

def redact(obj):
    """Recursively redact sensitive fields."""
    if not isinstance(obj, dict):
        return obj

    result = {}
    for key, value in obj.items():
        if key.lower() in REDACT_KEYS:
            result[key] = '[REDACTED]'
        elif isinstance(value, dict):
            result[key] = redact(value)
        else:
            result[key] = value
    return result
```

---

## Correlation with Events

Logs and events should align:

```typescript
// When writing an event, also log it
await eventStore.append({
  type: 'tool.called',
  payload: { toolName, args }
});

logger.info('Tool called', {
  run_id,
  step_id,
  toolName,
  args: redact(args)
});
```

**Why both?**
- **Events**: Permanent, traceable, replayed in UI
- **Logs**: Operational, debugging, alerts

---

## Log Rotation

### TypeScript (Winston + Rotating File Transport)

```bash
pnpm add winston-daily-rotate-file
```

```typescript
import DailyRotateFile from 'winston-daily-rotate-file';

logger.add(new DailyRotateFile({
  filename: 'logs/agent-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '100m',
  maxFiles: '14d',
  format: winston.format.json()
}));
```

### Python (Standard logging.handlers)

```python
from logging.handlers import RotatingFileHandler

handler = RotatingFileHandler(
    'logs/memory_skill.log',
    maxBytes=100 * 1024 * 1024,  # 100MB
    backupCount=5
)
logger.addHandler(handler)
```

---

## Anti-patterns

### ❌ Don't Log Inside Loops

```typescript
// ❌ Bad: Floods logs
events.forEach(event => {
  logger.debug('Processing event', { event });
});

// ✅ Good: Aggregate
logger.debug('Processing events', { count: events.length, types: [...new Set(events.map(e => e.type))] });
```

### ❌ Don't Use String Concatenation

```typescript
// ❌ Bad: Not structured, hard to parse
logger.info(`Run ${run_id} completed in ${duration_ms}ms`);

// ✅ Good: Structured fields
logger.info('Run completed', { run_id, duration_ms });
```

### ❌ Don't Log Before Validation

```typescript
// ❌ Bad: Logs potentially malicious input
logger.info('User input', { input: req.body });
validateInput(req.body);

// ✅ Good: Validate first
validateInput(req.body);
logger.info('User input validated', { input_length: req.body.input.length });
```

---

## Verification

### Check Log Output

```bash
# Start server and check logs
pnpm dev 2>&1 | jq '.'

# Grep for errors
tail -f logs/combined.log | jq 'select(.level == "error")'

# Check for leaked secrets (should return nothing)
grep -r 'api_key.*sk-' logs/
```

### ESLint Rule (Require Logger)

```json
// .eslintrc.json
{
  "rules": {
    "no-console": ["error", { "allow": ["warn", "error"] }]
  }
}
```

(Use `logger` instead of `console.log`)

---

## Related Specs

- [Error Handling](./error-handling.md) - Error logging format
- [Backend Directory Structure](./directory-structure.md) - Logger location
- [Quality Guidelines](./quality-guidelines.md) - Logging standards
