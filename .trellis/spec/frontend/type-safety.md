# Type Safety

> Type safety patterns in this project.

---

## Overview

The frontend uses TypeScript with strict mode enabled. Types are organized in `web/src/types/` and mirror backend domain models. The project does not use Zod on the frontend -- runtime validation is minimal, relying on the backend to validate inputs and the TypeScript compiler to catch type errors at build time.

ESLint enforces `@typescript-eslint/no-unused-vars` (with `argsIgnorePattern: "^_"`) and the `@typescript-eslint/recommended` ruleset.

---

## Type Organization

Types live in two files under `web/src/types/`:

- `web/src/types/index.ts` -- All domain types: `RunMeta`, `RunStatus`, `BaseEvent`, event payloads, `BlackboardMemory`, `Group`, `Role`, `Skill`, `GroupMember`, `GroupRunSummary`, etc.
- `web/src/types/events.ts` -- Specific event type interfaces (discriminated union) and API response types (`CreateRunResponse`, `ListRunsResponse`, `GetRunEventsResponse`, `ChatMessage`).

Component-local types (props interfaces, internal state types) are defined in the component file itself, not in the shared types directory.

Hook config/result interfaces are defined in the hook file and exported (e.g., `UseChatResult` in `useChat.ts`, `UseRunsResult` in `useRuns.ts`).

API client types are defined in `web/src/api/client.ts` (e.g., `ScopeConfig`, `RunLLMConfig`, `APIError`).

---

## Validation

The frontend does minimal runtime validation. The patterns used:

- **`as unknown` then type assertion**: When parsing JSON from `localStorage` or API responses, cast through `unknown` first:

```typescript
// See web/src/hooks/useChat.ts lines 52-57
const parsed = JSON.parse(raw) as unknown;
if (!parsed || typeof parsed !== 'object') return {};
return parsed as MessageMap;
```

- **`instanceof Error` checks**: When catching errors, always narrow with `instanceof`:

```typescript
setError(err instanceof Error ? err : new Error('Failed to load runs'));
```

- **API response typing**: The `APIClient` methods use generic `response.json()` with explicit return types:

```typescript
// See web/src/api/client.ts
async getRun(runId: string): Promise<RunMeta> {
  const response = await fetch(...);
  return response.json();  // typed by return annotation
}
```

- **Discriminated unions for events**: Events use a `type` field as the discriminant:

```typescript
// See web/src/types/events.ts
export type Event =
  | RunStartedEvent    // type: 'run.started'
  | RunCompletedEvent  // type: 'run.completed'
  | RunFailedEvent     // type: 'run.failed'
  | ToolCalledEvent    // type: 'tool.called'
  | ...;
```

Narrowing is done with `event.type` checks:

```typescript
// See web/src/components/Trace/TraceView.tsx lines 78-81
if (runStarted?.type === 'run.started') {
  // TypeScript knows payload is RunStartedPayload
  runStarted.payload.input
}
```

---

## Common Patterns

- **Type-only imports**: Use `import type` for types that are only used in type positions:

```typescript
import type { RunMeta, BlackboardMemory } from '../types';
import type { Event } from '../types/events';
import type { KeyboardEvent, ChangeEvent } from 'react';
```

- **Record types for maps**: Use `Record<string, T>` for key-value maps:

```typescript
// See web/src/hooks/useChat.ts
type MessageMap = Record<string, ChatMessage[]>;
type RunIdMap = Record<string, string | null>;
type ErrorMap = Record<string, Error | null>;
```

- **Union literal types for status/mode**: Use string literal unions for constrained values:

```typescript
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
type RunMode = 'single' | 'group';
export type AppLocale = 'en' | 'zh-CN';
```

- **`as const` for literal arrays**: Use `as const` when you need the array's element types to be literal:

```typescript
const EVENT_FILTERS: Array<Event['type'] | 'all'> = ['all', 'run.started', ...];
```

- **Optional chaining with nullish coalescing**: Used extensively for safe property access:

```typescript
const projectId = readString(req.header('x-project-id')) ?? readString(body['project_id']) ?? null;
const memories = prev[targetSessionKey] ?? [];
```

- **Generic component props with `ReactNode`**: Layout components accept children as `ReactNode`:

```typescript
interface AppShellProps {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}
```

---

## Forbidden Patterns

- **`any` type**: Use `unknown` and narrow with type guards. The ESLint config enforces `@typescript-eslint/no-unused-vars` but does not enforce `no-explicit-any` on the frontend (unlike the backend). Still, avoid `any` by convention.
- **Non-null assertion (`!`)**: Avoid `!` postfix. Use optional chaining (`?.`) or nullish coalescing (`??`) instead. The one exception is array access where the index is known valid (e.g., `options[0]!` in `ChatPage.tsx`).
- **Type assertions without `unknown`**: When parsing external data (localStorage, API), always cast through `unknown` first: `JSON.parse(raw) as unknown`, then narrow.
- **Inline type casts in JSX**: Avoid `as` casts in JSX expressions. Extract to a variable with proper typing instead.
- **Untyped event handlers**: Always type event handler parameters: `(e: ChangeEvent<HTMLTextAreaElement>)`, not `(e: any)`.
