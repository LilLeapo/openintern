# Hook Guidelines

> How hooks are used in this project.

---

## Overview

Custom hooks live in `web/src/hooks/` and follow a consistent pattern: each hook manages a specific domain concern (data fetching, SSE connections, chat state) and returns a typed result interface. The project does not use React Query or SWR -- data fetching is done with plain `fetch` via the `APIClient` class, wrapped in hooks that manage loading/error/data state manually.

---

## Custom Hook Patterns

Every custom hook follows this structure (see `web/src/hooks/useRuns.ts`):

```typescript
/**
 * useHookName - brief description
 */

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';
import type { SomeType } from '../types';

// 1. Export the result interface
export interface UseHookNameResult {
  data: SomeType[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

// 2. Export the hook function
export function useHookName(param: string): UseHookNameResult {
  const [data, setData] = useState<SomeType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadData = useCallback(async () => {
    if (!param) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.someMethod(param);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load'));
    } finally {
      setLoading(false);
    }
  }, [param]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return { data, loading, error, refresh: loadData };
}
```

Key conventions:
- Result interface is always exported and named `Use<HookName>Result`
- The hook returns an object (not a tuple)
- `loading`, `error` are standard fields in every data-fetching hook
- `useCallback` wraps all functions returned to consumers
- `useEffect` triggers initial data load, with `void` prefix for async calls
- Error normalization: `err instanceof Error ? err : new Error('fallback message')`

---

## Data Fetching

Data fetching hooks call methods on the singleton `apiClient` from `web/src/api/client.ts`. There is no caching layer -- each hook manages its own state.

Existing data-fetching hooks:

| Hook | File | Purpose |
|------|------|---------|
| `useRuns` | `web/src/hooks/useRuns.ts` | Paginated run list for a session |
| `useBlackboard` | `web/src/hooks/useBlackboard.ts` | Blackboard memories for a group |
| `useSSE` | `web/src/hooks/useSSE.ts` | SSE event stream for a run |
| `useChat` | `web/src/hooks/useChat.ts` | Chat messages with SSE streaming, localStorage persistence |

The `useChat` hook is the most complex -- it composes `useSSE` internally and manages message state across sessions using `localStorage`. See `web/src/hooks/useChat.ts` for the full pattern.

SSE connection management in `useSSE` (see `web/src/hooks/useSSE.ts`):

```typescript
export function useSSE(runId: string | null): UseSSEResult {
  const [events, setEvents] = useState<Event[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const clientRef = useRef<SSEClient | null>(null);

  useEffect(() => {
    if (!runId) return;
    const client = new SSEClient('', {
      onEvent: (event) => setEvents((prev) => [...prev, event]),
      onConnected: () => { setIsConnected(true); setError(null); },
      onError: (err) => setError(err),
      onDisconnected: () => setIsConnected(false),
    });
    clientRef.current = client;
    client.connect(runId);
    return () => { client.disconnect(); clientRef.current = null; };
  }, [runId]);

  return { events, isConnected, error, clearEvents };
}
```

---

## Naming Conventions

- Hook files: `use<Feature>.ts` in `web/src/hooks/` (e.g., `useChat.ts`, `useRuns.ts`)
- Hook functions: `use<Feature>` (e.g., `useChat`, `useRuns`, `useSSE`, `useBlackboard`)
- Result interfaces: `Use<Feature>Result` (e.g., `UseChatResult`, `UseRunsResult`)
- Internal state: standard `loading`/`error`/`data` naming
- Barrel exports: all hooks re-exported from `web/src/hooks/index.ts`
- Context hooks: `use<Context>` (e.g., `useAppPreferences` in `web/src/context/AppPreferencesContext.tsx`, `useLocaleText` in `web/src/i18n/useLocaleText.ts`)

---

## Common Mistakes

- **Missing cleanup in effects**: SSE connections and subscriptions must be cleaned up in the effect's return function. See `useSSE.ts` line 50-53 for the cleanup pattern.
- **Not guarding against null/empty params**: Always check if the required parameter is present before fetching. See `useRuns.ts` line 28: `if (!sessionKey) return;` and `useBlackboard.ts` line 33: `if (!groupId) return;`.
- **Forgetting `void` on async calls in effects**: `useEffect` callbacks cannot be async. Call async functions with `void loadData()` prefix.
- **Stale closure in refs**: When using `useRef` to track mutable state across renders (like `activeRunRef` in `useChat.ts`), update the ref in a separate `useEffect` to keep it in sync.
- **Not resetting state on parameter change**: When the hook's key parameter changes (e.g., `groupId`), reset the data state. See `useBlackboard.ts` lines 46-52 where `setMemories([])` is called when `groupId` becomes null.
- **Missing dependency in useCallback/useEffect**: Always include all referenced variables in the dependency array. The `react-hooks/recommended` ESLint plugin enforces this.
