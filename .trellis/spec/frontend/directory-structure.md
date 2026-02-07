# Frontend Directory Structure

> How frontend code is organized in this project.

---

## Overview

This project uses **React + TypeScript** with a feature-based directory structure.

**Key principles**:
- Features are self-contained (components + hooks + types)
- Shared code is in `common/` or `utils/`
- Pages are entry points that compose features
- No deep nesting (max 3 levels)

**Reference**: Based on backend/directory-structure.md pattern.

---

## Directory Layout

```
src/
├── web/                                # React Web UI
│   ├── pages/                          # Page entry points
│   │   ├── chat/                       # Chat page
│   │   │   ├── ChatPage.tsx            # Page component
│   │   │   ├── ChatLayout.tsx          # Layout wrapper
│   │   │   └── index.ts                # Barrel export
│   │   ├── trace/                      # Trace viewer page
│   │   │   ├── TracePage.tsx
│   │   │   ├── TraceLayout.tsx
│   │   │   └── index.ts
│   │   └── index.tsx                   # Root router
│   ├── components/                     # UI components
│   │   ├── chat/                       # Chat feature components
│   │   │   ├── ChatInput.tsx           # Message input
│   │   │   ├── ChatMessages.tsx        # Message list
│   │   │   ├── MessageItem.tsx         # Single message
│   │   │   └── useChatState.ts         # Chat state hook
│   │   ├── trace/                      # Trace feature components
│   │   │   ├── TraceViewer.tsx         # Main trace viewer
│   │   │   ├── EventList.tsx           # Event timeline
│   │   │   ├── EventRenderer.tsx       # Renders individual events
│   │   │   ├── SpanTree.tsx            # Span hierarchy tree
│   │   │   └── useTraceData.ts         # Trace data hook
│   │   └── common/                     # Shared components
│   │       ├── Button.tsx
│   │       ├── Input.tsx
│   │       ├── Spinner.tsx
│   │       └── ErrorBoundary.tsx
│   ├── hooks/                          # Custom hooks
│   │   ├── useEventStream.ts           # SSE event streaming
│   │   ├── useRunMetadata.ts           # Run metadata fetching
│   │   └── useDebounce.ts              # Utility hook
│   ├── api/                            # API client
│   │   ├── client.ts                   # Base HTTP client
│   │   ├── runs.ts                     # Runs API endpoints
│   │   ├── sessions.ts                 # Sessions API endpoints
│   │   └── types.ts                    # API request/response types
│   ├── types/                          # Frontend-specific types
│   │   ├── ui.ts                       # UI state types
│   │   └── index.ts                    # Re-exports
│   ├── utils/                          # Utility functions
│   │   ├── formatters.ts               # Date/time/duration formatters
│   │   ├── colors.ts                   # Color schemes (event types, status)
│   │   └── constants.ts                # UI constants
│   └── App.tsx                         # Root app component
├── types/                              # Shared types (backend + frontend)
│   ├── events.ts                       # Event types
│   ├── run.ts                          # Run metadata types
│   └── ...
└── ...
```

---

## Module Organization

### Pages (Entry Points)

Pages are **thin wrappers** that compose features:

```tsx
// src/web/pages/chat/ChatPage.tsx

import { ChatLayout } from './ChatLayout';
import { ChatMessages } from '@/web/components/chat/ChatMessages';
import { ChatInput } from '@/web/components/chat/ChatInput';
import { useChatState } from '@/web/components/chat/useChatState';

export function ChatPage() {
  const { messages, sendMessage, isLoading } = useChatState();

  return (
    <ChatLayout>
      <ChatMessages messages={messages} />
      <ChatInput onSend={sendMessage} disabled={isLoading} />
    </ChatLayout>
  );
}
```

**Rules**:
- No business logic in pages (only composition)
- Use layout components for page structure
- All state managed by hooks

### Components (Features)

Components are grouped by feature (not by type):

```
components/
├── chat/                    # ✅ Feature-based
│   ├── ChatInput.tsx
│   ├── ChatMessages.tsx
│   └── useChatState.ts
└── trace/
    ├── TraceViewer.tsx
    └── useTraceData.ts

NOT like this:
components/
├── inputs/                  # ❌ Type-based
│   ├── ChatInput.tsx
│   └── SearchInput.tsx
└── lists/
    └── ChatMessages.tsx
```

**Why feature-based**:
- Related code stays together
- Easy to move features
- Clear ownership

### Hooks (Custom Logic)

**Location rules**:

1. **Feature-specific hooks** → Co-located with components
   ```tsx
   // src/web/components/chat/useChatState.ts
   export function useChatState() {
     // Chat-specific state logic
   }
   ```

2. **Shared hooks** → `src/web/hooks/`
   ```tsx
   // src/web/hooks/useEventStream.ts
   export function useEventStream(runId: string) {
     // Generic SSE streaming logic
   }
   ```

3. **Utility hooks** → `src/web/hooks/`
   ```tsx
   // src/web/hooks/useDebounce.ts
   export function useDebounce<T>(value: T, delay: number): T {
     // Generic debouncing
   }
   ```

### API Client (HTTP Layer)

```typescript
// src/web/api/client.ts
export const apiClient = {
  async get<T>(url: string): Promise<T> {
    const response = await fetch(`/api${url}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },

  async post<T>(url: string, data: unknown): Promise<T> {
    const response = await fetch(`/api${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },
};
```

```typescript
// src/web/api/runs.ts
import { apiClient } from './client';
import type { RunMeta, CreateRunRequest } from './types';

export const runsApi = {
  async create(request: CreateRunRequest): Promise<RunMeta> {
    return apiClient.post<RunMeta>('/runs', request);
  },

  async get(runId: string): Promise<RunMeta> {
    return apiClient.get<RunMeta>(`/runs/${runId}`);
  },

  async list(sessionKey: string): Promise<RunMeta[]> {
    return apiClient.get<RunMeta[]>(`/runs?session_key=${sessionKey}`);
  },
};
```

**Rules**:
- One file per API resource (runs, sessions, memory)
- All endpoints return typed results
- Use shared `apiClient` for HTTP logic

---

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| React components | `PascalCase.tsx` | `ChatInput.tsx`, `TraceViewer.tsx` |
| Custom hooks | `use*.ts` | `useChatState.ts`, `useTraceData.ts` |
| Utility functions | `camelCase.ts` | `formatters.ts`, `colors.ts` |
| Type files | `camelCase.ts` | `types/ui.ts`, `api/types.ts` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_MESSAGE_LENGTH`, `DEFAULT_PAGE_SIZE` |

**Component file structure**:

```tsx
// ChatInput.tsx

// 1. Imports
import { useState } from 'react';
import { Button } from '@/web/components/common/Button';

// 2. Types (if local to component)
interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

// 3. Component
export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [text, setText] = useState('');

  const handleSubmit = () => {
    if (text.trim()) {
      onSend(text);
      setText('');
    }
  };

  return (
    <div>
      <input value={text} onChange={e => setText(e.target.value)} />
      <Button onClick={handleSubmit} disabled={disabled}>
        Send
      </Button>
    </div>
  );
}
```

---

## Import Path Rules

Use **absolute imports** from `src/`:

```tsx
// ✅ Good: Absolute imports
import { ChatInput } from '@/web/components/chat/ChatInput';
import { Event } from '@/types/events';
import { runsApi } from '@/web/api/runs';

// ❌ Bad: Relative imports crossing modules
import { ChatInput } from '../../components/chat/ChatInput';
```

**Setup**: Configure path aliases in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

---

## Anti-patterns

### ❌ Don't Create Deep Nesting

```
❌ src/web/components/chat/messages/list/MessageList.tsx  (5 levels)
✅ src/web/components/chat/ChatMessages.tsx                (3 levels)
```

**Max nesting**: 3 levels from `src/`

### ❌ Don't Mix Features in One Directory

```
❌ components/
    ├── ChatInput.tsx       # Chat feature
    ├── TraceViewer.tsx     # Trace feature (different!)
    └── MessageItem.tsx     # Chat feature

✅ components/
    ├── chat/
    │   ├── ChatInput.tsx
    │   └── MessageItem.tsx
    └── trace/
        └── TraceViewer.tsx
```

### ❌ Don't Put Logic in Components

```tsx
// ❌ Bad: Fetching logic in component
export function ChatMessages() {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    fetch('/api/messages')
      .then(res => res.json())
      .then(setMessages);
  }, []);

  return <div>{/* ... */}</div>;
}

// ✅ Good: Extract to hook
export function ChatMessages() {
  const messages = useMessages(); // Hook handles fetching
  return <div>{/* ... */}</div>;
}
```

### ❌ Don't Create Barrel Exports Everywhere

```tsx
// ❌ Bad: Barrel export for components
// components/chat/index.ts
export * from './ChatInput';
export * from './ChatMessages';
// (Hides dependencies, slows build)

// ✅ Good: Direct imports
import { ChatInput } from '@/web/components/chat/ChatInput';
import { ChatMessages } from '@/web/components/chat/ChatMessages';
```

**Only use barrel exports for**:
- Page directories (`pages/chat/index.ts`)
- Type directories (`types/index.ts`)

---

## Examples

### Well-Organized Feature

```
components/chat/
├── ChatInput.tsx           # Input component
├── ChatMessages.tsx        # Message list component
├── MessageItem.tsx         # Single message component
├── useChatState.ts         # Chat state hook
└── types.ts                # Chat-specific types (if needed)
```

### Page Structure

```tsx
// pages/chat/ChatPage.tsx
import { ChatLayout } from './ChatLayout';
import { ChatMessages } from '@/web/components/chat/ChatMessages';
import { ChatInput } from '@/web/components/chat/ChatInput';
import { useChatState } from '@/web/components/chat/useChatState';

export function ChatPage() {
  const state = useChatState();

  return (
    <ChatLayout>
      <ChatMessages {...state} />
      <ChatInput {...state} />
    </ChatLayout>
  );
}
```

---

## Verification

### Check Structure

```bash
# Check directory depth (should be ≤3 from src/)
find src/web -type f -name "*.tsx" | awk -F/ '{print NF-1, $0}' | sort -n | tail

# Check for barrel exports (should be minimal)
find src/web/components -name "index.ts" -o -name "index.tsx"

# Check import paths (should use @/ alias)
grep -r "from '\.\./" src/web/
# (Should return minimal results)
```

### ESLint Rules

```json
// .eslintrc.json
{
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        "patterns": ["../*", "../../*"]
      }
    ]
  }
}
```

---

## Related Specs

- [Component Guidelines](./component-guidelines.md) - Component patterns
- [Hook Guidelines](./hook-guidelines.md) - Custom hooks
- [Type Safety](./type-safety.md) - TypeScript types
