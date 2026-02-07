# Type Safety

> TypeScript type safety patterns for the Agent System.

---

## Overview

This project uses **strict TypeScript** with comprehensive type definitions for all runtime data structures.

**Key principles**:
- All event/checkpoint/run structures are typed
- API boundaries use runtime validation (Zod)
- No `any` except in exceptional cases (must be documented)
- Type-safe event handling with discriminated unions

**Reference**: Project.md sections 3.2 (event format), 4.2 (context types).

---

## Type Organization

### Core Types Location

```
src/types/
├── events.ts          # Event types (discriminated union)
├── checkpoint.ts      # Checkpoint structure
├── run.ts             # Run metadata
├── tools.ts           # Tool definitions (MCP-compatible)
├── agent.ts           # Agent state types
└── index.ts           # Barrel export
```

### Type Export Rules

1. **Shared types** → `src/types/` (exported via barrel)
2. **Component-local types** → Inline in component file
3. **API types** → Co-located with API routes

```typescript
// ✅ Good: Shared type in types/
// src/types/events.ts
export interface Event { /* ... */ }

// ✅ Good: Local type inline
// src/web/components/chat/ChatInput.tsx
interface ChatInputProps {
  onSubmit: (text: string) => void;
}

// ✅ Good: API types co-located
// src/backend/api/runs.ts
interface CreateRunRequest {
  session_key: string;
  input: string;
}
```

---

## Core Type Definitions

### Event Types (Discriminated Union)

Based on Project.md section 3.2:

```typescript
// src/types/events.ts

export type EventType =
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'step.started'
  | 'step.completed'
  | 'model.started'
  | 'model.delta'
  | 'model.completed'
  | 'tool.called'
  | 'tool.result'
  | 'memory.written'
  | 'memory.retrieved'
  | 'checkpoint.saved';

// Base event structure
interface BaseEvent {
  v: 1;
  ts: string; // ISO 8601
  session_key: string;
  run_id: string;
  agent_id: string;
  step_id: string;
  span_id: string;
  parent_span_id: string | null;
  redaction: {
    contains_secrets: boolean;
  };
}

// Discriminated union for type-safe event handling
export type Event =
  | RunStartedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | ToolCalledEvent
  | ToolResultEvent
  | MemoryWrittenEvent
  | MemoryRetrievedEvent
  | CheckpointSavedEvent;

// Concrete event types
export interface RunStartedEvent extends BaseEvent {
  type: 'run.started';
  payload: {
    input: string;
    goal?: string;
  };
}

export interface RunCompletedEvent extends BaseEvent {
  type: 'run.completed';
  payload: {
    result: string;
    stats: {
      total_steps: number;
      total_tool_calls: number;
      duration_ms: number;
    };
  };
}

export interface RunFailedEvent extends BaseEvent {
  type: 'run.failed';
  payload: {
    error: {
      code: string;
      message: string;
      details?: Record<string, any>;
    };
  };
}

export interface ToolCalledEvent extends BaseEvent {
  type: 'tool.called';
  payload: {
    toolName: string;
    args: Record<string, any>;
  };
}

export interface ToolResultEvent extends BaseEvent {
  type: 'tool.result';
  payload: {
    toolName: string;
    result?: any;
    isError: boolean;
    error?: {
      message: string;
      code: string;
    };
  };
}

// ... (other event types)
```

### Checkpoint Types

Based on Project.md section 3.4:

```typescript
// src/types/checkpoint.ts

export interface Checkpoint {
  v: 1;
  session_key: string;
  run_id: string;
  agent_id: string;
  step_id: string;
  state: AgentState;
}

export interface AgentState {
  goal: string;
  plan: string[];
  working_summary: string;
  tool_state: Record<string, any>;
  context_cursor: ContextCursor;
}

export interface ContextCursor {
  last_event_ts: string;
  messages_included: number;
  memory_ids_used: string[];
}
```

### Run Metadata

Based on Project.md section 6.1:

```typescript
// src/types/run.ts

export interface RunMeta {
  v: 1;
  run_id: string;
  session_key: string;
  agent_id: string;
  title: string;
  status: RunStatus;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  stats: RunStats;
}

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RunStats {
  total_steps: number;
  total_tool_calls: number;
  total_tokens?: number;
  duration_ms?: number;
}
```

### Tool Types (MCP-compatible)

Based on Project.md section 4.3:

```typescript
// src/types/tools.ts

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  provider: ToolProvider;
}

export type ToolProvider = 'local' | `mcp:${string}`;

export interface ToolCallRequest {
  toolName: string;
  args: Record<string, any>;
}

export interface ToolCallResult {
  result?: any;
  isError: boolean;
  error?: {
    message: string;
    code: string;
  };
}

// JSON Schema type (simplified)
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  [key: string]: any;
}
```

---

## Validation

### Runtime Validation with Zod

Use Zod for API boundary validation:

```bash
pnpm add zod
```

```typescript
// src/backend/api/validation.ts

import { z } from 'zod';

// Define schema
export const CreateRunRequestSchema = z.object({
  session_key: z.string().regex(/^s_[a-zA-Z0-9_]+$/),
  input: z.string().min(1).max(10000),
  agent_id: z.string().optional().default('main'),
});

export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

// Use in API route
app.post('/api/runs', async (req, res) => {
  try {
    const data = CreateRunRequestSchema.parse(req.body);
    const run = await runService.create(data);
    res.json(run);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          details: error.errors
        }
      });
    } else {
      throw error;
    }
  }
});
```

### Event Schema Validation

```typescript
// src/types/events.ts

import { z } from 'zod';

const BaseEventSchema = z.object({
  v: z.literal(1),
  ts: z.string().datetime(),
  session_key: z.string(),
  run_id: z.string(),
  agent_id: z.string(),
  step_id: z.string(),
  span_id: z.string(),
  parent_span_id: z.string().nullable(),
  redaction: z.object({
    contains_secrets: z.boolean(),
  }),
});

export const RunStartedEventSchema = BaseEventSchema.extend({
  type: z.literal('run.started'),
  payload: z.object({
    input: z.string(),
    goal: z.string().optional(),
  }),
});

// Runtime validation
export function validateEvent(data: unknown): Event {
  // Try each event schema
  // (In practice, use discriminated union validation)
  return EventSchema.parse(data);
}
```

---

## Type-safe Event Handling

Use discriminated unions for exhaustive checking:

```typescript
// src/web/components/trace/EventRenderer.tsx

function renderEvent(event: Event): JSX.Element {
  switch (event.type) {
    case 'run.started':
      return <RunStartedView event={event} />;
      // event.payload is typed as RunStartedEvent['payload']

    case 'tool.called':
      return <ToolCalledView event={event} />;
      // event.payload is typed as ToolCalledEvent['payload']

    case 'tool.result':
      if (event.payload.isError) {
        return <ErrorView error={event.payload.error} />;
      }
      return <ToolResultView result={event.payload.result} />;

    // TypeScript error if you miss a case (when --strictNullChecks)
    default:
      const _exhaustive: never = event;
      return <div>Unknown event: {(_exhaustive as Event).type}</div>;
  }
}
```

---

## Common Patterns

### Type Guards

```typescript
// src/types/events.ts

export function isErrorEvent(event: Event): event is RunFailedEvent | ToolResultEvent {
  return event.type === 'run.failed' ||
         (event.type === 'tool.result' && event.payload.isError);
}

// Usage
if (isErrorEvent(event)) {
  // event is narrowed to RunFailedEvent | ToolResultEvent
  console.error(event.payload.error);
}
```

### Generic Utilities

```typescript
// src/types/utils.ts

// Make all fields optional recursively
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Extract payload type from event
export type EventPayload<T extends Event['type']> = Extract<Event, { type: T }>['payload'];

// Usage
type ToolCalledPayload = EventPayload<'tool.called'>;
// => { toolName: string; args: Record<string, any>; }
```

### Branded Types (ID Safety)

```typescript
// src/types/ids.ts

declare const brand: unique symbol;

export type RunId = string & { [brand]: 'RunId' };
export type SessionKey = string & { [brand]: 'SessionKey' };
export type StepId = string & { [brand]: 'StepId' };

export function createRunId(prefix: string): RunId {
  return `run_${prefix}_${Date.now()}` as RunId;
}

// Usage
function getRunEvents(runId: RunId): Event[] {
  // Type-safe: can't accidentally pass session_key
}

const runId = createRunId('demo');
getRunEvents(runId); // ✅ OK
getRunEvents('s_demo'); // ❌ TypeScript error
```

---

## TypeScript Config

### tsconfig.json (Strict Mode)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "skipLibCheck": true,

    // Strict mode (REQUIRED)
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,

    // Path aliases
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },

    // Output
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Forbidden Patterns

### ❌ Don't Use `any`

```typescript
// ❌ Bad: Loses all type safety
function processEvent(event: any) {
  console.log(event.paylaod.result); // Typo not caught
}

// ✅ Good: Use unknown + type guard
function processEvent(event: unknown) {
  if (isEvent(event)) {
    console.log(event.payload.result); // Typed
  }
}

// ✅ Acceptable: External untyped library (document why)
const rawData = externalLib.getData() as any; // TODO: Add types for externalLib
```

### ❌ Don't Use Type Assertions Without Validation

```typescript
// ❌ Bad: Unchecked assertion
const event = JSON.parse(line) as Event;

// ✅ Good: Validate first
const rawEvent = JSON.parse(line);
const event = EventSchema.parse(rawEvent);
```

### ❌ Don't Suppress Errors with `@ts-ignore`

```typescript
// ❌ Bad: Hiding type errors
// @ts-ignore
const result = event.payload.resutl; // Typo hidden

// ✅ Good: Fix the error
const result = event.payload.result;
```

### ❌ Don't Use Non-null Assertion (`!`) Without Justification

```typescript
// ❌ Bad: Hiding potential null
const result = maybeResult!.value;

// ✅ Good: Handle null case
if (maybeResult) {
  const result = maybeResult.value;
}

// ✅ Acceptable: With comment explaining why it's safe
const result = maybeResult!.value; // Safe: checked in previous if block
```

---

## Verification

### Type Check Command

```bash
# Must pass before commit
pnpm tsc --noEmit
```

### ESLint Rules

```json
// .eslintrc.json
{
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/strict-boolean-expressions": "error",
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-call": "error"
  }
}
```

---

## Related Specs

- [Backend Directory Structure](../backend/directory-structure.md) - Type file locations
- [Component Guidelines](./component-guidelines.md) - Component prop types
- [Backend Error Handling](../backend/error-handling.md) - Error types
