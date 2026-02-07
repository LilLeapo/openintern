# Hook Guidelines

> How hooks are used in this project.

---

## Overview

This project uses **React Hooks** for all stateful logic and side effects.

**Key principles**:
- Custom hooks extract reusable logic
- Hooks follow Rules of Hooks (linting enforced)
- Data fetching is centralized in custom hooks
- Hook naming always starts with `use*`

**Reference**: Based on Python hooks pattern (`.claude/hooks/`) adapted for React.

---

## Custom Hook Patterns

### Basic Custom Hook Template

```tsx
// src/web/components/chat/useChatState.ts

import { useState, useCallback } from 'react';
import { runsApi } from '@/web/api/runs';

export function useChatState() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await runsApi.create({
        session_key: 's_demo',
        input: text,
      });

      setMessages(prev => [...prev, {
        id: response.run_id,
        text,
        sender: 'user',
      }]);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    messages,
    sendMessage,
    isLoading,
    error,
  };
}
```

**Structure**:
1. State declarations
2. Effect hooks (useEffect, etc.)
3. Event handlers (useCallback)
4. Return object (public API)

---

## Data Fetching Hooks

### Fetch-on-Mount Pattern

```tsx
// src/web/hooks/useRunMetadata.ts

import { useState, useEffect } from 'react';
import { runsApi } from '@/web/api/runs';
import type { RunMeta } from '@/types/run';

export function useRunMetadata(runId: string) {
  const [data, setData] = useState<RunMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchRun() {
      try {
        const meta = await runsApi.get(runId);
        if (!cancelled) {
          setData(meta);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchRun();

    return () => {
      cancelled = true; // Cancel on unmount
    };
  }, [runId]);

  return { data, isLoading, error };
}
```

**Important**: Always use cleanup function to prevent state updates after unmount.

### Event Stream Hook (SSE)

```tsx
// src/web/hooks/useEventStream.ts

import { useState, useEffect, useCallback } from 'react';
import type { Event } from '@/types/events';

export function useEventStream(runId: string) {
  const [events, setEvents] = useState<Event[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const eventSource = new EventSource(`/api/runs/${runId}/stream`);

    eventSource.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as Event;
        setEvents(prev => [...prev, event]);
      } catch (err) {
        console.error('Failed to parse event', err);
      }
    };

    eventSource.onerror = (err) => {
      setError(new Error('Stream connection failed'));
      setIsConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, [runId]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return {
    events,
    isConnected,
    error,
    clearEvents,
  };
}
```

---

## Utility Hooks

### Debounce Hook

```tsx
// src/web/hooks/useDebounce.ts

import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Usage
const searchQuery = useDebounce(inputValue, 500);
```

### Local Storage Hook

```tsx
// src/web/hooks/useLocalStorage.ts

import { useState, useEffect } from 'react';

export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error('Failed to read localStorage', error);
      return initialValue;
    }
  });

  const setValue = (value: T) => {
    try {
      setStoredValue(value);
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('Failed to write localStorage', error);
    }
  };

  return [storedValue, setValue];
}

// Usage
const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('theme', 'light');
```

### Previous Value Hook

```tsx
// src/web/hooks/usePrevious.ts

import { useRef, useEffect } from 'react';

export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

// Usage
const prevCount = usePrevious(count);
if (prevCount !== undefined && count !== prevCount) {
  console.log(`Count changed from ${prevCount} to ${count}`);
}
```

---

## Naming Conventions

### Hook Names Always Start with `use`

```tsx
// ✅ Good
export function useChatState() { /* ... */ }
export function useEventStream() { /* ... */ }
export function useDebounce() { /* ... */ }

// ❌ Bad
export function chatState() { /* ... */ }  // Missing 'use' prefix
export function getEvents() { /* ... */ }  // Not a hook
```

### Return Object for Multiple Values

```tsx
// ✅ Good: Named object (easy to extend)
export function useRunMetadata(runId: string) {
  return {
    data,
    isLoading,
    error,
    refetch, // Easy to add new fields
  };
}

// ❌ Bad: Array return (hard to extend)
export function useRunMetadata(runId: string): [RunMeta | null, boolean, Error | null] {
  return [data, isLoading, error]; // What's the 4th item?
}

// ✅ Exception: Array return for useState-like hooks
export function useToggle(initialValue: boolean): [boolean, () => void] {
  const [value, setValue] = useState(initialValue);
  const toggle = useCallback(() => setValue(v => !v), []);
  return [value, toggle];
}
```

---

## Common Patterns

### Conditional Hook Execution (via Early Return)

```tsx
// ❌ Bad: Conditional hook call (violates Rules of Hooks)
export function Component({ runId }: { runId?: string }) {
  if (runId) {
    const data = useRunMetadata(runId); // WRONG: conditional hook
  }
}

// ✅ Good: Always call hook, handle undefined inside
export function useRunMetadata(runId: string | undefined) {
  const [data, setData] = useState<RunMeta | null>(null);

  useEffect(() => {
    if (!runId) return; // Early return, but hook always called

    async function fetch() {
      const meta = await runsApi.get(runId);
      setData(meta);
    }
    fetch();
  }, [runId]);

  return { data };
}
```

### Cleanup Pattern

```tsx
export function useInterval(callback: () => void, delay: number) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    function tick() {
      savedCallback.current();
    }

    const id = setInterval(tick, delay);

    // Cleanup: clear interval on unmount
    return () => {
      clearInterval(id);
    };
  }, [delay]);
}
```

### Stable Callback Pattern

```tsx
export function useChatState() {
  const [messages, setMessages] = useState<Message[]>([]);

  // ✅ Good: useCallback with dependencies
  const addMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, { id: Date.now(), text }]);
  }, []); // No dependencies (uses functional update)

  // ❌ Bad: No useCallback (new function every render)
  const addMessageBad = (text: string) => {
    setMessages([...messages, { id: Date.now(), text }]);
  };

  return { messages, addMessage };
}
```

---

## Testing Hooks

### Test with renderHook

```tsx
// src/web/hooks/useDebounce.test.ts

import { renderHook, act } from '@testing-library/react';
import { useDebounce } from './useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should debounce value changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 500 } }
    );

    expect(result.current).toBe('initial');

    // Update value
    rerender({ value: 'updated', delay: 500 });
    expect(result.current).toBe('initial'); // Still old value

    // Fast-forward time
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(result.current).toBe('updated'); // Now updated
  });
});
```

---

## Anti-patterns

### ❌ Don't Call Hooks Conditionally

```tsx
// ❌ Bad: Conditional hook call
if (condition) {
  const data = useData(); // WRONG
}

// ❌ Bad: Hook in loop
items.forEach(() => {
  const data = useData(); // WRONG
});

// ✅ Good: Always call at top level
const data = useData();
if (condition) {
  // Use data here
}
```

### ❌ Don't Forget Dependencies

```tsx
// ❌ Bad: Missing dependency
useEffect(() => {
  fetchData(userId);
}, []); // userId missing from deps

// ✅ Good: All dependencies listed
useEffect(() => {
  fetchData(userId);
}, [userId]);

// ✅ Good: Use ESLint rule to enforce
// eslint-disable-next-line react-hooks/exhaustive-deps
```

### ❌ Don't Update State During Render

```tsx
// ❌ Bad: State update during render
export function Component({ value }: { value: number }) {
  const [state, setState] = useState(0);

  if (value > 10) {
    setState(value); // WRONG: causes infinite loop
  }

  return <div>{state}</div>;
}

// ✅ Good: Update in useEffect
export function Component({ value }: { value: number }) {
  const [state, setState] = useState(0);

  useEffect(() => {
    if (value > 10) {
      setState(value);
    }
  }, [value]);

  return <div>{state}</div>;
}
```

### ❌ Don't Create New Objects in Dependencies

```tsx
// ❌ Bad: Object created on every render
useEffect(() => {
  fetchData({ userId, filter });
}, [{ userId, filter }]); // New object every render

// ✅ Good: Primitive dependencies
useEffect(() => {
  fetchData({ userId, filter });
}, [userId, filter]);

// ✅ Good: Memoize object if needed
const options = useMemo(() => ({ userId, filter }), [userId, filter]);
useEffect(() => {
  fetchData(options);
}, [options]);
```

---

## Verification

### Hook Checklist

- [ ] Hook name starts with `use`
- [ ] Follows Rules of Hooks (no conditional calls)
- [ ] All dependencies listed in useEffect/useCallback/useMemo
- [ ] Cleanup function provided for subscriptions/timers
- [ ] Return value is typed
- [ ] Tested with renderHook

### ESLint Rules

```json
{
  "rules": {
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn"
  }
}
```

---

## Related Specs

- [Component Guidelines](./component-guidelines.md) - Using hooks in components
- [State Management](./state-management.md) - Global state hooks
- [Type Safety](./type-safety.md) - Hook return types
