# Logging Guidelines

> How logging is done in this project.

---

## Overview

The project uses a custom structured logger defined in `src/utils/logger.ts`. It is a singleton `Logger` class exported as `logger`. The logger outputs JSON-structured lines to stdout/stderr via `console.debug/info/warn/error`. The minimum log level defaults to `info` and can be changed at runtime with `logger.setLevel()`.

ESLint enforces `no-console` as a warning (allowing only `console.warn` and `console.error`). All application code should use the `logger` singleton instead of `console.*` directly. The logger file itself has `/* eslint-disable no-console */` at the top.

---

## Log Levels

| Level   | Priority | When to use | Console method |
|---------|----------|-------------|----------------|
| `debug` | 0        | Detailed execution tracing: tool calls, memory operations, parameter values. Disabled by default. | `console.debug` |
| `info`  | 1        | Significant lifecycle events: run started/completed, queue operations, tool registration, migrations. | `console.info` |
| `warn`  | 2        | Recoverable problems: failed checkpoint save, vector index load failure, tool overwrite, queue persistence failure. | `console.warn` |
| `error` | 3        | Unrecoverable failures: run failed, tool call failed, critical service errors. | `console.error` |

---

## Structured Logging

Every log call takes a `message` string and an optional `context` object. The logger formats output as:

```
[2025-01-15T10:30:00.000Z] INFO: Run enqueued {"runId":"run_abc123","queueLength":3}
```

The `LogContext` type is `Record<string, unknown>`. Always pass structured data as the context object, not interpolated into the message string:

```typescript
// CORRECT - structured context
logger.info('Run enqueued', { runId: run.run_id, queueLength: this.queue.length });

// WRONG - interpolated message
logger.info(`Run ${run.run_id} enqueued, queue length: ${this.queue.length}`);
```

Common context fields used across the codebase:

- `runId` - run identifier
- `error` - error message string (extracted via `err instanceof Error ? err.message : String(err)`)
- `duration` - operation duration in ms
- `name` - tool or component name
- `params` - tool parameters (at debug level only)
- `resultCount` - number of results returned
- `query` - search query text
- `provider` - LLM or embedding provider name
- `restored` - number of items restored from persistence

---

## What to Log

Based on actual usage patterns in the codebase:

- **Run lifecycle**: enqueue, start, complete, fail, cancel (see `src/backend/queue/run-queue.ts`)
- **Tool operations**: registration, call start, call completion, call failure with duration (see `src/backend/agent/tool-router.ts`)
- **Memory operations**: write, search with result count (at debug level, see `src/backend/agent/tool-router.ts` lines 225-253)
- **Initialization**: hybrid search setup, built-in tool registration, migration completion (see `src/backend/agent/tool-router.ts` lines 115-198)
- **Queue state**: restore from disk, persistence failures (see `src/backend/queue/run-queue.ts`)
- **Error recovery**: checkpoint save failures, vector index load failures (at warn level)

---

## What NOT to Log

- **Secrets and API keys**: Never log LLM API keys, tokens, or credentials. The `src/utils/redact.ts` module provides `redactSecrets()` for sanitizing event payloads before storage.
- **Full request/response bodies**: Log summary fields (runId, status) not entire payloads.
- **User content at info level**: User input and LLM output should only appear at `debug` level. At `info` level, log content length instead: `{ contentLength: content.length }`.
- **PII**: Do not log user emails, names, or other personally identifiable information.
- **Stack traces in context objects**: Pass `error.message` as a string, not the full Error object. The logger serializes context with `JSON.stringify` which would lose the stack anyway.

---

## Import Pattern

Always import the singleton logger:

```typescript
import { logger } from '../../utils/logger.js';
```

The path depth varies by file location but always resolves to `src/utils/logger.js` (note the `.js` extension for ESM).
