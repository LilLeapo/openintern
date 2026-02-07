# State Management

> How state is managed in this project.

---

## Overview

This project uses **React built-in state management** (useState + Context) with minimal external libraries.

**Key principles**:
- Local state first (useState, useReducer)
- Context for shared state (theme, session, user)
- No Redux (keep it simple)
- Server state via custom hooks (not global state)

**Reference**: Based on component-guidelines.md and hook-guidelines.md patterns.

---

## State Categories

### 1. Local State (Component-Level)

Use `useState` or `useReducer` for state that doesn't need to be shared.

```tsx
// src/web/components/chat/ChatInput.tsx

export function ChatInput({ onSend }: ChatInputProps) {
  // ✅ Local state (only used in this component)
  const [text, setText] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  return (
    <textarea
      value={text}
      onChange={e => setText(e.target.value)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    />
  );
}
```

**When to use**:
- UI state (open/closed, focused/blurred)
- Form inputs
- Temporary flags
- Data used only by one component

### 2. Shared State (via Context)

Use React Context for state shared across multiple components.

```tsx
// src/web/contexts/SessionContext.tsx

import { createContext, useContext, useState, ReactNode } from 'react';

interface SessionContextValue {
  sessionKey: string;
  setSessionKey: (key: string) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessionKey, setSessionKey] = useState<string>('s_demo');

  return (
    <SessionContext.Provider value={{ sessionKey, setSessionKey }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}
```

**When to use**:
- Current session
- Theme (light/dark mode)
- User authentication
- App-level settings

### 3. Server State (Fetched Data)

Use custom hooks for data fetched from API (not global state).

```tsx
// src/web/hooks/useRunMetadata.ts

export function useRunMetadata(runId: string) {
  const [data, setData] = useState<RunMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Fetch data
  }, [runId]);

  return { data, isLoading, error };
}

// Usage (each component fetches independently)
export function RunDetails({ runId }: { runId: string }) {
  const { data, isLoading } = useRunMetadata(runId);
  // ...
}
```

**When to use**:
- API responses
- Event streams
- Database queries
- Any data that originates from server

**Why not global state**:
- Data is tied to specific params (runId, sessionKey)
- Easier to invalidate/refetch
- No stale data issues
- Components are self-contained

### 4. URL State (Router Params/Query)

Use URL for state that should be shareable/bookmarkable.

```tsx
// src/web/pages/trace/TracePage.tsx

import { useSearchParams } from 'react-router-dom';

export function TracePage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const runId = searchParams.get('runId') || '';
  const filter = searchParams.get('filter') || 'all';

  const setFilter = (newFilter: string) => {
    setSearchParams({ runId, filter: newFilter });
  };

  return <TraceViewer runId={runId} filter={filter} />;
}
```

**When to use**:
- Current run/session ID
- Filter/sort options
- Pagination state
- Any state user might want to share via URL

---

## When to Use Global State

### Decision Tree

```
Does the state need to be shared across multiple routes/pages?
  ├─ NO  → Use local state (useState)
  └─ YES → Is it server data (API response)?
             ├─ YES → Use custom hook (not global)
             └─ NO  → Is it user setting/preference?
                      ├─ YES → Use Context
                      └─ NO  → Can it go in URL?
                               ├─ YES → Use URL params
                               └─ NO  → Use Context
```

### Examples

| State | Category | Solution |
|-------|----------|----------|
| Chat input text | Local | `useState` |
| Modal open/closed | Local | `useState` |
| Current theme | Shared | Context |
| Current session | Shared | Context |
| Run metadata | Server | Custom hook |
| Event stream | Server | Custom hook |
| Current run ID | URL | Search params |
| Filter options | URL | Search params |

---

## Context Patterns

### Basic Context Setup

```tsx
// src/web/contexts/ThemeContext.tsx

import { createContext, useContext, useState, ReactNode, useMemo } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');

  // ✅ Memoize context value to prevent unnecessary re-renders
  const value = useMemo(
    () => ({ theme, setTheme }),
    [theme]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
```

### Context with LocalStorage Persistence

```tsx
// src/web/contexts/SessionContext.tsx

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessionKey, setSessionKeyState] = useState<string>(() => {
    // Load from localStorage on init
    return localStorage.getItem('sessionKey') || 's_demo';
  });

  const setSessionKey = useCallback((key: string) => {
    setSessionKeyState(key);
    localStorage.setItem('sessionKey', key);
  }, []);

  const value = useMemo(
    () => ({ sessionKey, setSessionKey }),
    [sessionKey, setSessionKey]
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}
```

### Multiple Contexts (Composition)

```tsx
// src/web/App.tsx

export function App() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </ThemeProvider>
  );
}
```

---

## Derived State

### Compute Derived State During Render

```tsx
// ❌ Bad: Storing derived state in useState
export function Component({ events }: { events: Event[] }) {
  const [errorCount, setErrorCount] = useState(0);

  useEffect(() => {
    setErrorCount(events.filter(e => e.type === 'run.failed').length);
  }, [events]);

  return <div>Errors: {errorCount}</div>;
}

// ✅ Good: Compute during render
export function Component({ events }: { events: Event[] }) {
  const errorCount = events.filter(e => e.type === 'run.failed').length;
  return <div>Errors: {errorCount}</div>;
}

// ✅ Better: Memoize if expensive
export function Component({ events }: { events: Event[] }) {
  const errorCount = useMemo(
    () => events.filter(e => e.type === 'run.failed').length,
    [events]
  );
  return <div>Errors: {errorCount}</div>;
}
```

### Use Selectors for Complex Derivations

```tsx
// src/web/utils/selectors.ts

export function selectErrorEvents(events: Event[]): Event[] {
  return events.filter(e => e.type === 'run.failed' || e.payload.isError);
}

export function selectEventsByType(events: Event[], type: EventType): Event[] {
  return events.filter(e => e.type === type);
}

// Usage
export function TraceViewer({ events }: { events: Event[] }) {
  const errors = useMemo(() => selectErrorEvents(events), [events]);
  const toolCalls = useMemo(
    () => selectEventsByType(events, 'tool.called'),
    [events]
  );

  return (
    <div>
      <ErrorList events={errors} />
      <ToolCallList events={toolCalls} />
    </div>
  );
}
```

---

## State Synchronization

### Syncing State with Props

```tsx
// ❌ Bad: Props not synced to state
export function Component({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  // Problem: If initialValue changes, state doesn't update
}

// ✅ Good: Controlled component (no internal state)
export function Component({ value, onChange }: {
  value: string;
  onChange: (v: string) => void;
}) {
  return <input value={value} onChange={e => onChange(e.target.value)} />;
}

// ✅ Also good: Sync via useEffect (if uncontrolled needed)
export function Component({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  return <input value={value} onChange={e => setValue(e.target.value)} />;
}
```

### Syncing Multiple State Variables

```tsx
// Use useReducer for complex state logic
import { useReducer } from 'react';

type State = {
  isLoading: boolean;
  data: Data | null;
  error: Error | null;
};

type Action =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: Data }
  | { type: 'FETCH_ERROR'; payload: Error };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH_START':
      return { isLoading: true, data: null, error: null };
    case 'FETCH_SUCCESS':
      return { isLoading: false, data: action.payload, error: null };
    case 'FETCH_ERROR':
      return { isLoading: false, data: null, error: action.payload };
    default:
      return state;
  }
}

export function useData() {
  const [state, dispatch] = useReducer(reducer, {
    isLoading: false,
    data: null,
    error: null,
  });

  const fetch = useCallback(async () => {
    dispatch({ type: 'FETCH_START' });
    try {
      const data = await fetchData();
      dispatch({ type: 'FETCH_SUCCESS', payload: data });
    } catch (error) {
      dispatch({ type: 'FETCH_ERROR', payload: error as Error });
    }
  }, []);

  return { ...state, fetch };
}
```

---

## Anti-patterns

### ❌ Don't Use Global State for Server Data

```tsx
// ❌ Bad: Storing API response in global state
const GlobalRunContext = createContext<RunMeta | null>(null);

export function RunProvider({ children }) {
  const [run, setRun] = useState<RunMeta | null>(null);

  useEffect(() => {
    runsApi.get('run_123').then(setRun);
  }, []);

  return <GlobalRunContext.Provider value={run}>{children}</GlobalRunContext.Provider>;
}

// ✅ Good: Fetch in custom hook (component-level)
export function RunDetails({ runId }: { runId: string }) {
  const { data } = useRunMetadata(runId);
  return <div>{data?.title}</div>;
}
```

### ❌ Don't Prop Drill More Than 2 Levels

```tsx
// ❌ Bad: Prop drilling through 5 levels
<App theme={theme}>
  <Layout theme={theme}>
    <Sidebar theme={theme}>
      <Nav theme={theme}>
        <NavItem theme={theme} />
      </Nav>
    </Sidebar>
  </Layout>
</App>

// ✅ Good: Use Context
<ThemeProvider>
  <App>
    <Layout>
      <Sidebar>
        <Nav>
          <NavItem />  {/* Gets theme from useTheme() */}
        </Nav>
      </Sidebar>
    </Layout>
  </App>
</ThemeProvider>
```

### ❌ Don't Over-Use Context

```tsx
// ❌ Bad: Separate context for every piece of state
<UserContext>
  <ThemeContext>
    <LanguageContext>
      <SidebarContext>
        <ModalContext>
          <ToastContext>
            <App />
          </ToastContext>
        </ModalContext>
      </SidebarContext>
    </LanguageContext>
  </ThemeContext>
</UserContext>

// ✅ Good: Combine related state
<AppContext>  {/* theme + language + user */}
  <UIContext>  {/* sidebar + modal + toast */}
    <App />
  </UIContext>
</AppContext>
```

---

## Verification

### State Management Checklist

- [ ] No server data in global state (use custom hooks)
- [ ] Context values are memoized (prevent re-renders)
- [ ] No prop drilling beyond 2 levels
- [ ] Derived state computed during render (not stored)
- [ ] Reducers used for complex state logic
- [ ] URL params used for shareable state

### Performance Check

```tsx
// Use React DevTools Profiler to check:
// - Are components re-rendering unnecessarily?
// - Is context value changing on every render? (should be memoized)
```

---

## Related Specs

- [Hook Guidelines](./hook-guidelines.md) - Custom hooks for state
- [Component Guidelines](./component-guidelines.md) - Local state patterns
- [Type Safety](./type-safety.md) - Typing context values
