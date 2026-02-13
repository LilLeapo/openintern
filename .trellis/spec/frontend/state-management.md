# State Management

> How state is managed in this project.

---

## Overview

The project uses React's built-in state primitives exclusively -- no Redux, Zustand, Jotai, or other external state libraries. State is managed through `useState`, `useCallback`, `useMemo`, `useRef`, `useContext`, and `useEffect`. Persistence to `localStorage` is done manually where needed.

---

## State Categories

### Local Component State

Most state lives in individual components or hooks via `useState`. This is the default choice.

```typescript
// See web/src/pages/TracePage.tsx
const [events, setEvents] = useState<Event[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<Error | null>(null);
const [viewMode, setViewMode] = useState<'steps' | 'events'>('steps');
```

### Hook-Encapsulated State

Data-fetching state is encapsulated in custom hooks that return a typed result object. Pages consume these hooks without managing the underlying state directly.

```typescript
// See web/src/pages/ChatPage.tsx
const { messages, isRunning, error, sendMessage, clearMessages, latestRunId } =
  useChat(sessionKey, { llmConfig, runMode, groupId: activeGroupId });
const { runs: sessionRuns, loading: runsLoading, refresh: refreshSessionRuns } =
  useRuns(sessionKey, 8);
```

### Global State (React Context)

Only one Context exists: `AppPreferencesContext` in `web/src/context/AppPreferencesContext.tsx`. It manages cross-cutting preferences that multiple pages need:

- `sessionKey` / `setSessionKey` -- current conversation ID
- `sessionHistory` -- list of recent session keys
- `createSession` / `removeSession` -- session lifecycle
- `selectedGroupId` / `setSelectedGroupId` -- active orchestrator group
- `locale` / `setLocale` -- UI language (`'en'` or `'zh-CN'`)

The provider wraps the entire app in `App.tsx`:

```typescript
<AppPreferencesProvider>
  <BrowserRouter>
    <Routes>...</Routes>
  </BrowserRouter>
</AppPreferencesProvider>
```

Consumed via the `useAppPreferences()` hook, which throws if used outside the provider:

```typescript
export function useAppPreferences(): AppPreferencesContextValue {
  const context = useContext(AppPreferencesContext);
  if (!context) {
    throw new Error('useAppPreferences must be used inside AppPreferencesProvider');
  }
  return context;
}
```

### Persisted State (localStorage)

Several pieces of state are persisted to `localStorage` for cross-session continuity:

| Key | Owner | Purpose |
|-----|-------|---------|
| `openintern.session_key` | `AppPreferencesContext` | Current session ID |
| `openintern.session_history` | `AppPreferencesContext` | Recent session list (max 24) |
| `openintern.group_id` | `AppPreferencesContext` | Selected group ID |
| `openintern.locale` | `AppPreferencesContext` | UI language preference |
| `openintern.chat.messages.v1` | `useChat` | Chat messages by session (max 200 per session) |
| `openintern.chat.latest_runs.v1` | `useChat` | Latest run ID per session |
| `openintern.chat.provider` | `ChatPage` | Selected LLM provider |
| `openintern.chat.model` | `ChatPage` | Selected LLM model |
| `openintern.chat.assistant_target` | `ChatPage` | Solo vs team mode selection |

The persistence pattern uses `useEffect` to write on state change:

```typescript
// See web/src/hooks/useChat.ts lines 124-135
useEffect(() => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    MESSAGE_STORAGE_KEY,
    JSON.stringify(trimMessageMap(messagesBySession)),
  );
}, [messagesBySession]);
```

And a read function for initialization:

```typescript
function readStoredMessages(): MessageMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(MESSAGE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as MessageMap;
  } catch {
    return {};
  }
}
```

### URL State

Route parameters are used for entity-specific pages via React Router:

```typescript
// See web/src/App.tsx
<Route path="/trace/:runId" element={<TracePage />} />
<Route path="/blackboard/:groupId" element={<BlackboardPage />} />
```

Consumed with `useParams`:

```typescript
const { runId } = useParams<{ runId: string }>();
```

---

## When to Use Global State

Add to `AppPreferencesContext` only when:
- The value is needed by multiple unrelated pages (e.g., session key used by ChatPage, RunsPage, AppShell)
- The value should persist across page navigation
- The value affects the app shell/layout (e.g., locale changes the sidebar language)

Everything else stays local to the hook or component that owns it.

---

## Server State

There is no server-state caching layer. Each hook fetches fresh data on mount and provides a `refresh()` function for manual re-fetching. Real-time updates come through SSE (managed by `useSSE`), not polling.

The `useChat` hook merges SSE events into local state as they arrive, processing `llm.token`, `run.completed`, and `run.failed` events to build the message stream (see `web/src/hooks/useChat.ts` lines 138-257).

---

## Common Mistakes

- **Putting everything in Context**: Only cross-cutting preferences belong in `AppPreferencesContext`. Feature-specific state (messages, events, runs) stays in hooks.
- **Not guarding `localStorage` reads**: Always wrap `JSON.parse` in try/catch and check `typeof window !== 'undefined'` for SSR safety. Return a sensible default on failure.
- **Unbounded localStorage growth**: The `useChat` hook caps messages at `MAX_MESSAGES_PER_SESSION = 200` per session and trims on write. New persisted state should have similar bounds.
- **Derived state in `useState`**: Use `useMemo` for computed values instead of syncing derived state with `useEffect`. See `ChatPage.tsx` line 180 where `stats` is computed with `useMemo`, not stored separately.
- **Missing `useMemo` on context value**: The `AppPreferencesContext` provider wraps its value object in `useMemo` to prevent unnecessary re-renders of all consumers. New context providers must do the same.
