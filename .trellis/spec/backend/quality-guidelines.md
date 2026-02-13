# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

The backend enforces quality through TypeScript strict mode, ESLint with `@typescript-eslint`, and Vitest for testing. The ESLint config lives in `.eslintrc.json` at the repo root and extends `eslint:recommended`, `plugin:@typescript-eslint/recommended`, and `plugin:@typescript-eslint/recommended-requiring-type-checking`.

Key commands:
- `pnpm lint` - run ESLint on `src/`
- `pnpm typecheck` - run `tsc --noEmit`
- `pnpm test` - run Vitest (unit tests in `src/**/*.test.ts`)

---

## Forbidden Patterns

These are enforced by ESLint rules or established by convention:

- **`any` type**: `@typescript-eslint/no-explicit-any` is set to `"error"`. Use `unknown` and narrow with type guards instead.
- **Unused variables**: `@typescript-eslint/no-unused-vars` is `"error"`. Prefix intentionally unused parameters with `_` (e.g., `_req`, `_next`).
- **Direct `console.*` calls**: `no-console` is `"warn"` with only `console.warn` and `console.error` allowed. Use the `logger` singleton from `src/utils/logger.js` instead.
- **String interpolation in SQL**: Never build SQL with template literals containing user values. Always use `$1`, `$2` parameterized placeholders.
- **Bare `throw "string"`**: Always throw `Error` instances or `AgentError` subclasses.
- **Mutable module-level state**: Avoid `let` at module scope. Use classes with constructor injection or factory functions.
- **Relative imports without `.js` extension**: ESM requires `.js` extensions on all relative imports (e.g., `import { logger } from '../../utils/logger.js'`).

---

## Required Patterns

- **Explicit return types on exported functions**: `@typescript-eslint/explicit-function-return-type` is `"warn"` with `allowExpressions: true`. All exported functions should have explicit return type annotations.
- **Zod for request validation**: All API request bodies are validated with Zod's `safeParse()`. On failure, throw `ValidationError` with the first error's message and path (see `src/backend/api/runs.ts`).
- **Error wrapping**: When catching errors, always check `error instanceof Error` before accessing `.message`. Use `String(error)` as fallback.
- **Dependency injection via constructor**: Repository and service classes take their dependencies (e.g., `Pool`, other services) as constructor parameters. No global singletons except `logger`.
- **Config objects with defaults**: Use `Partial<Config>` parameters merged with a `DEFAULT_CONFIG` constant (see `src/backend/agent/tool-router.ts` lines 48-52, `src/backend/queue/run-queue.ts` lines 55-60).

```typescript
// Standard config pattern
const DEFAULT_CONFIG: QueueConfig = {
  maxSize: 100,
  timeoutMs: 300000,
  autoProcess: true,
  persistDir: null,
};

constructor(config: Partial<QueueConfig> = {}) {
  this.config = { ...DEFAULT_CONFIG, ...config };
}
```

- **Async IIFE in Express handlers**: Route handlers wrap async logic in `void (async () => { try { ... } catch (error) { next(error); } })()` to properly propagate errors to Express error middleware.

---

## Testing Requirements

Tests use Vitest with the following configuration (see `vitest.config.ts`):

- **Environment**: `node`
- **Globals**: enabled (`describe`, `it`, `expect` available without import)
- **File pattern**: `src/**/*.test.ts`
- **Coverage**: V8 provider, reporters: text, json, html

Test file conventions:
- Co-located with source: `agent-loop.test.ts` next to `agent-loop.ts`
- Integration tests: `<name>.integration.test.ts`
- Use descriptive `describe`/`it` blocks
- Mock external dependencies (LLM clients, database) rather than hitting real services

What to test:
- Error classification logic (see `src/backend/agent/error-classifier.ts` -- pure function, easy to unit test)
- Tool routing and execution (mock the tool's `execute` function)
- Queue operations (enqueue, dequeue, cancel, timeout)
- Zod schema validation (test both valid and invalid inputs)
- Scope predicate building (pure function in `src/backend/runtime/scope.ts`)

---

## Code Review Checklist

- [ ] No `any` types -- use `unknown` with type narrowing
- [ ] All SQL queries use parameterized placeholders (`$1`, `$2`)
- [ ] New migrations are idempotent (`IF NOT EXISTS` guards)
- [ ] Errors are properly classified (retryable vs fatal) if they affect the agent loop
- [ ] Structured logging with context objects, not string interpolation
- [ ] No secrets or PII in log output
- [ ] Exported functions have explicit return types
- [ ] Request bodies validated with Zod `safeParse()`
- [ ] New dependencies justified and minimal
- [ ] `.js` extension on all relative imports
- [ ] Tests cover the happy path and at least one error path
