# Error Handling

> How errors are handled in this project.

---

## Overview

The project uses a class hierarchy rooted at `AgentError` (defined in `src/utils/errors.ts`). Each error class carries a machine-readable `code`, an HTTP `statusCode`, and optional `details`. Errors propagate through Express middleware and are serialized into a standard JSON response format.

---

## Error Types

All custom errors extend `AgentError`. See `src/utils/errors.ts`:

```typescript
// Base error - all others extend this
export class AgentError extends Error {
  constructor(
    message: string,
    public code: string,           // machine-readable code, e.g. 'NOT_FOUND'
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) { ... }
}

// Storage errors (500)
export class EventStoreError extends AgentError { code: 'EVENT_STORE_ERROR' }
export class CheckpointStoreError extends AgentError { code: 'CHECKPOINT_STORE_ERROR' }
export class MemoryStoreError extends AgentError { code: 'MEMORY_STORE_ERROR' }
export class ProjectionStoreError extends AgentError { code: 'PROJECTION_STORE_ERROR' }

// Tool errors (500)
export class ToolError extends AgentError { code: 'TOOL_ERROR', includes toolName }

// Client errors
export class ValidationError extends AgentError { code: 'VALIDATION_ERROR', statusCode: 400 }
export class NotFoundError extends AgentError { code: 'NOT_FOUND', statusCode: 404 }
export class SandboxError extends AgentError { code: 'SANDBOX_ERROR', statusCode: 403 }

// External service errors
export class LLMError extends AgentError { code: 'LLM_ERROR', statusCode: 502, includes provider and httpStatus }
```

---

## Error Handling Patterns

**API route handlers** use async IIFE with `try/catch` and pass errors to `next()` (see `src/backend/api/runs.ts` lines 84-135):

```typescript
router.post('/runs', (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    try {
      const parseResult = CreateRunRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.errors[0];
        throw new ValidationError(
          firstError?.message ?? 'Invalid request',
          firstError?.path.join('.') ?? 'body'
        );
      }
      // ... business logic
      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  })();
});
```

**Express error middleware** maps error types to HTTP responses (see `src/backend/api/runs.ts` lines 305-321):

```typescript
router.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof NotFoundError) {
    sendError(res, {
      error: { code: err.code, message: err.message, details: err.details },
    }, err.statusCode);
    return;
  }
  next(err);
});
```

**Agent loop errors** are caught at the top level and converted to `run.failed` events with checkpoint saving for recovery (see `src/backend/agent/agent-loop.ts` lines 554-588):

```typescript
private async handleError(error: unknown): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  this.status.status = 'failed';
  this.status.error = errorMessage;

  // Save checkpoint on failure for potential recovery
  try {
    await this.contextManager.saveCheckpoint();
  } catch (cpErr) {
    logger.warn('Failed to save failure checkpoint', { ... });
  }

  await this.emitEvent({
    type: 'run.failed',
    payload: { error: { code: 'AGENT_ERROR', message: errorMessage } },
  });
}
```

**Error classification** for retry decisions uses `src/backend/agent/error-classifier.ts`. Errors are classified as `retryable` or `fatal`:

- Retryable: HTTP 429/500/502/503/504, network errors (ECONNRESET, ETIMEDOUT, etc.)
- Fatal: `ValidationError`, `SandboxError`, `NotFoundError`, unrecognized errors

```typescript
// See src/backend/agent/error-classifier.ts
const classified = classifyError(error);
if (classified.category === 'retryable') {
  // retry with backoff
} else {
  // fail immediately
}
```

**Tool execution errors** are caught and returned as `ToolResult` with `success: false` rather than thrown (see `src/backend/agent/tool-router.ts` lines 324-374):

```typescript
async callTool(name: string, params: Record<string, unknown>): Promise<ToolResult> {
  try {
    const result = await Promise.race([tool.execute(params), this.createTimeout(name)]);
    return { success: true, result, duration };
  } catch (error) {
    return { success: false, error: errorMessage, duration };
  }
}
```

---

## API Error Responses

All API errors follow a standard JSON format defined by `ErrorResponseSchema` in `src/types/api.ts`:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Run not found: run_abc123",
    "details": { "resource": "Run", "id": "run_abc123" }
  }
}
```

HTTP status codes are determined by the error class:
- 400: `ValidationError` (bad input, missing fields)
- 403: `SandboxError` (security violation)
- 404: `NotFoundError` (resource not found)
- 502: `LLMError` (upstream LLM provider failure)
- 500: all other `AgentError` subclasses

---

## Common Mistakes

- **Swallowing errors silently**: Always log errors before returning a fallback. The codebase uses `logger.warn` for non-critical failures (e.g., failed checkpoint save) and `logger.error` for critical ones.
- **Throwing raw strings**: Always throw an `Error` instance or an `AgentError` subclass, never a bare string.
- **Forgetting `instanceof` checks**: When catching errors, always check `error instanceof Error` before accessing `.message`. Use `String(error)` as fallback: `error instanceof Error ? error.message : String(error)`.
- **Not saving checkpoints on failure**: The agent loop saves a checkpoint even on failure so runs can be resumed. New error handlers should follow this pattern.
- **Leaking internal details**: Error responses to clients should use the structured `{ error: { code, message } }` format. Stack traces and internal paths must not be exposed.
