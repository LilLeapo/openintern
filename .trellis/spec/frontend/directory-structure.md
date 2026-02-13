# Directory Structure

> How frontend code is organized in this project.

---

## Overview

The frontend is a React 18 SPA built with Vite, TypeScript, and React Router v6. It lives in the `web/` directory at the repo root, completely separate from the backend `src/` tree. Styling uses CSS Modules (`.module.css` files co-located with components). There is no CSS-in-JS or Tailwind.

Key dependencies: `react`, `react-dom`, `react-router-dom`. Dev tooling: Vite, Vitest, Playwright, ESLint with `@typescript-eslint` and `react-hooks` plugin.

---

## Directory Layout

```
web/src/
├── api/                    # API client layer
│   ├── client.ts           # APIClient class (REST calls via fetch)
│   ├── sse.ts              # SSEClient class (EventSource wrapper)
│   └── index.ts            # Barrel exports
├── components/             # Reusable UI components, grouped by feature
│   ├── Chat/               # Chat feature components
│   │   ├── ChatWindow.tsx
│   │   ├── ChatMessage.tsx
│   │   ├── ChatInput.tsx
│   │   ├── Chat.module.css
│   │   └── index.ts        # Barrel: export { ChatWindow, ChatMessage, ChatInput }
│   ├── Trace/              # Trace/event viewer components
│   │   ├── TraceView.tsx
│   │   ├── StepCard.tsx
│   │   ├── EventList.tsx
│   │   ├── ToolCallCard.tsx
│   │   ├── Trace.module.css
│   │   └── index.ts
│   ├── Runs/               # Run list components
│   │   ├── RunsList.tsx
│   │   ├── RunCard.tsx
│   │   ├── Runs.module.css
│   │   └── index.ts
│   ├── Blackboard/         # Blackboard/memory components
│   │   ├── BlackboardPanel.tsx
│   │   ├── DecisionCard.tsx
│   │   ├── EvidenceList.tsx
│   │   ├── TodoList.tsx
│   │   ├── BlackboardPanel.module.css
│   │   └── index.ts
│   └── Layout/             # Shell/layout components
│       ├── AppShell.tsx
│       └── AppShell.module.css
├── context/                # React Context providers
│   └── AppPreferencesContext.tsx  # Session, locale, group preferences
├── hooks/                  # Custom React hooks
│   ├── useChat.ts          # Chat state + SSE streaming
│   ├── useRuns.ts          # Run list fetching
│   ├── useSSE.ts           # SSE connection management
│   ├── useBlackboard.ts    # Blackboard data fetching
│   └── index.ts            # Barrel exports
├── i18n/                   # Internationalization
│   └── useLocaleText.ts    # t(en, zh) helper hook
├── pages/                  # Route-level page components
│   ├── ChatPage.tsx
│   ├── TracePage.tsx
│   ├── RunsPage.tsx
│   ├── BlackboardPage.tsx
│   ├── OrchestratorPage.tsx
│   ├── SkillsPage.tsx
│   ├── *.module.css        # Page-specific styles
│   └── index.ts            # Barrel exports
├── styles/                 # Global styles
│   └── global.css
├── test/                   # Test files
│   ├── setup.ts            # Vitest setup (jsdom)
│   ├── ChatWindow.test.tsx
│   ├── TraceView.test.tsx
│   └── client.test.ts
├── types/                  # TypeScript type definitions
│   ├── index.ts            # Domain types (RunMeta, Group, Role, Skill, events, etc.)
│   └── events.ts           # Specific event type unions and API response types
├── App.tsx                 # Root component with BrowserRouter and Routes
├── main.tsx                # Entry point (createRoot, StrictMode)
└── vite-env.d.ts           # Vite type declarations
```

---

## Module Organization

New features follow this pattern:

1. **Types**: Add interfaces to `web/src/types/index.ts` (or a new file if the feature is large).
2. **API methods**: Add methods to the `APIClient` class in `web/src/api/client.ts`.
3. **Hook**: Create `web/src/hooks/use<Feature>.ts` for data fetching and state management.
4. **Components**: Create `web/src/components/<Feature>/` directory with component files, a CSS module, and an `index.ts` barrel.
5. **Page**: Create `web/src/pages/<Feature>Page.tsx` that composes the hook and components.
6. **Route**: Add a `<Route>` entry in `web/src/App.tsx`.

Example: the Blackboard feature follows `types/index.ts` (BlackboardMemory) -> `api/client.ts` (getBlackboard) -> `hooks/useBlackboard.ts` -> `components/Blackboard/` -> `pages/BlackboardPage.tsx` -> `App.tsx` route.

---

## Naming Conventions

- Component files: `PascalCase.tsx` (e.g., `ChatWindow.tsx`, `RunCard.tsx`)
- Hook files: `camelCase.ts` with `use` prefix (e.g., `useChat.ts`, `useSSE.ts`)
- CSS Modules: `<Feature>.module.css` co-located with components (e.g., `Chat.module.css`)
- Page files: `<Feature>Page.tsx` (e.g., `ChatPage.tsx`, `TracePage.tsx`)
- Barrel files: `index.ts` in each component directory, exporting all public components
- Type files: `camelCase.ts` in `types/` directory
- Test files: `<Component>.test.tsx` in `test/` directory

---

## Examples

- Well-structured component group: `web/src/components/Chat/` -- three components, one CSS module, one barrel
- Page with hooks composition: `web/src/pages/ChatPage.tsx` -- uses `useChat`, `useRuns`, `useAppPreferences`, `useLocaleText`
- API client pattern: `web/src/api/client.ts` -- class with scope headers, error parsing, typed responses
- Context provider: `web/src/context/AppPreferencesContext.tsx` -- localStorage-backed preferences with `useAppPreferences` hook
