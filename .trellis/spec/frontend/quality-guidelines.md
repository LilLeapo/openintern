# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

The frontend enforces quality through TypeScript strict mode, ESLint with `@typescript-eslint` and `react-hooks` plugins, Vitest for unit tests, and Playwright for E2E tests. The ESLint config lives in `web/.eslintrc.json`.

Key commands (run from the `web/` directory):
- `pnpm lint` -- ESLint on `web/src/`
- `pnpm typecheck` -- `tsc --noEmit`
- `pnpm test` -- Vitest (unit tests)
- `pnpm test:e2e` -- Playwright (E2E tests)

---

## Forbidden Patterns

- **`any` type**: Use `unknown` with type narrowing. While the frontend ESLint config does not enforce `no-explicit-any` as strictly as the backend, avoid `any` by convention.
- **Unused variables**: `@typescript-eslint/no-unused-vars` is `"error"`. Prefix intentionally unused parameters with `_`.
- **Default exports**: The entire codebase uses named exports. Do not use `export default`.
- **Class components**: Use function components exclusively. No `React.Component` or `React.PureComponent`.
- **Direct DOM manipulation**: Use React refs and state instead of `document.querySelector` or `document.getElementById` (except in `main.tsx` for the root element).
- **Hardcoded English strings in JSX**: All user-facing text must use `t(en, zh)` from `useLocaleText()` for bilingual support.
- **Inline styles for layout**: Use CSS Modules. Inline styles are only acceptable for truly dynamic values (e.g., computed textarea height in `ChatInput.tsx`).
- **`console.log` in production code**: Use it only during development. The SSE client uses `console.error` for parse failures (see `web/src/api/sse.ts` line 57), which is acceptable.

---

## Required Patterns

- **Named exports with barrel files**: Every component directory has an `index.ts` that re-exports public components. Pages are re-exported from `web/src/pages/index.ts`.
- **Props interfaces**: Every component defines and exports a `<ComponentName>Props` interface.
- **Error boundaries in hooks**: Every data-fetching hook returns `error: Error | null` and normalizes caught errors with `err instanceof Error ? err : new Error('fallback')`.
- **Cleanup in effects**: Effects that create subscriptions (SSE, timers) must return a cleanup function.
- **`void` prefix for async calls**: When calling async functions in effects or event handlers, prefix with `void` to satisfy the linter: `void loadRuns()`, `() => void sendMessage(prompt)`.
- **`useMemo` for context values**: Context providers must wrap their value object in `useMemo` to prevent unnecessary re-renders (see `AppPreferencesContext.tsx` lines 174-197).
- **`useCallback` for returned functions**: Functions returned from hooks must be wrapped in `useCallback` with correct dependencies.
- **Bilingual text**: Use `const { t } = useLocaleText()` and call `t('English text', 'Chinese text')` for all user-facing strings.

---

## Testing Requirements

Tests use Vitest with jsdom environment and `@testing-library/react`.

Configuration (see `web/package.json`):
- Unit tests: `pnpm test` (Vitest)
- E2E tests: `pnpm test:e2e` (Playwright)

Test file location: `web/src/test/` directory (not co-located with components).

Test conventions (see `web/src/test/ChatWindow.test.tsx`):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatWindow } from '../components/Chat/ChatWindow';

describe('ChatWindow', () => {
  it('renders empty state when no messages', () => {
    render(<ChatWindow messages={[]} onSend={vi.fn()} />);
    expect(screen.getByText(/start a conversation/i)).toBeInTheDocument();
  });

  it('renders messages', () => {
    const messages = [
      { id: 'msg_1', role: 'user' as const, content: 'Hello', timestamp: new Date().toISOString() },
    ];
    render(<ChatWindow messages={messages} onSend={vi.fn()} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

What to test:
- Component rendering with different prop combinations (empty state, with data, loading, error)
- User interactions (button clicks, form submissions) via `@testing-library/react`
- API client methods (mock `fetch`, verify request shape)
- Hook behavior (if complex enough to warrant isolated testing)

What not to test:
- CSS Module class names (they are hashed and unstable)
- Implementation details (internal state, private functions)

---

## Code Review Checklist

- [ ] No `any` types
- [ ] All user-facing strings use `t(en, zh)` for bilingual support
- [ ] CSS Modules used for styling (no inline styles for layout)
- [ ] Props interface exported with `<ComponentName>Props` naming
- [ ] Named exports only (no `export default`)
- [ ] Effects have cleanup functions where needed (SSE, timers, subscriptions)
- [ ] Async calls in effects/handlers prefixed with `void`
- [ ] Error states handled and displayed to the user
- [ ] Loading states shown during data fetching
- [ ] `aria-label` on interactive elements without visible labels
- [ ] New components added to barrel `index.ts`
- [ ] New hooks added to `web/src/hooks/index.ts` barrel
- [ ] localStorage reads wrapped in try/catch with sensible defaults
