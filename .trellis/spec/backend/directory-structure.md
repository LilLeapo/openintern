# Directory Structure

> How backend code is organized in this project.

---

## Overview

The backend is a TypeScript Node.js application using Express, PostgreSQL (via `pg`), and Zod for validation. Code lives under `src/` at the repo root, with a separate `web/` directory for the frontend and `python/` for the MCP skill server.

The project uses ES modules (`"type": "module"` in `package.json`), TypeScript strict mode, and path aliases (`@/*` maps to `src/*`).

---

## Directory Layout

```
src/
├── backend/
│   ├── api/              # Express route handlers (REST endpoints)
│   │   ├── runs.ts       # Run lifecycle endpoints (POST/GET/cancel/stream)
│   │   ├── feishu-connectors.ts
│   │   └── sse.ts        # SSE manager for real-time event push
│   ├── agent/            # Single-agent execution engine
│   │   ├── agent-loop.ts # Core plan/act/observe loop
│   │   ├── context-manager.ts  # LLM context building and trimming
│   │   ├── tool-router.ts      # Tool registration and execution
│   │   ├── llm-client.ts       # LLM provider abstraction (OpenAI/Anthropic/mock)
│   │   ├── anthropic-client.ts
│   │   ├── openai-client.ts
│   │   ├── error-classifier.ts # Retryable vs fatal error classification
│   │   ├── retry-policy.ts
│   │   ├── orphan-detector.ts  # Detect orphaned tool calls on resume
│   │   ├── context-trimmer.ts
│   │   ├── token-counter.ts
│   │   ├── file-tools.ts       # Built-in file operation tools
│   │   ├── mcp-client.ts       # MCP protocol client
│   │   ├── sandbox/            # Security sandbox for tool execution
│   │   │   ├── path-guard.ts
│   │   │   ├── file-type-guard.ts
│   │   │   ├── rate-limiter.ts
│   │   │   ├── permission-matrix.ts
│   │   │   └── index.ts
│   │   └── index.ts
│   ├── runtime/          # Multi-agent orchestration and Postgres-backed services
│   │   ├── orchestrator.ts
│   │   ├── agent-runner.ts
│   │   ├── run-repository.ts   # Postgres CRUD for runs/events/checkpoints
│   │   ├── event-service.ts    # Event read/write facade
│   │   ├── memory-service.ts
│   │   ├── checkpoint-service.ts
│   │   ├── request-scope.ts    # Extract org/user/project scope from HTTP requests
│   │   ├── scope.ts            # Scope context types and SQL predicate helpers
│   │   ├── role-repository.ts
│   │   ├── group-repository.ts
│   │   ├── skill-registry.ts
│   │   ├── skill-repository.ts
│   │   ├── skill-loader.ts
│   │   ├── tool-router.ts      # Runtime-level tool router (policy-aware)
│   │   ├── tool-policy.ts
│   │   ├── tool-scheduler.ts
│   │   ├── prompt-composer.ts
│   │   ├── token-budget-manager.ts
│   │   ├── compaction-service.ts
│   │   ├── role-runner-factory.ts
│   │   ├── mcp-connection-manager.ts
│   │   ├── models.ts           # Shared runtime model types
│   │   ├── feishu-*.ts         # Feishu connector services
│   │   ├── mineru-*.ts         # MinerU PDF ingestion services
│   │   └── index.ts
│   ├── queue/            # In-memory run queue with serial execution
│   │   ├── run-queue.ts
│   │   └── index.ts
│   ├── db/               # Database connection and schema
│   │   ├── postgres.ts   # Pool management, migrations, query/transaction helpers
│   │   ├── schema.ts     # Idempotent DDL statements array
│   │   └── index.ts
│   └── store/            # File-based storage (JSONL event sourcing, legacy)
│       ├── event-store.ts
│       ├── checkpoint-store.ts
│       ├── memory-store.ts
│       ├── vector-index.ts
│       ├── hybrid-searcher.ts
│       └── embedding-provider.ts
├── types/                # Shared Zod schemas and TypeScript types
│   ├── agent.ts          # AgentStatus, ToolCall, Message, LLMConfig, etc.
│   ├── events.ts         # All event schemas (discriminated union)
│   ├── api.ts            # Request/response schemas (CreateRunRequest, etc.)
│   ├── run.ts            # RunMeta, RunStatus
│   ├── memory.ts
│   ├── checkpoint.ts
│   ├── orchestrator.ts
│   ├── scope.ts
│   ├── skill.ts
│   ├── embedding.ts
│   ├── feishu.ts
│   └── mineru.ts
├── config/               # Configuration loading
│   ├── loader.ts         # Loads agent.config.json
│   └── index.ts
├── utils/                # Cross-cutting utilities
│   ├── errors.ts         # Error class hierarchy
│   ├── logger.ts         # Structured logger singleton
│   ├── ids.ts            # ID generators (run_, sp_, mem_, step_, etc.)
│   └── redact.ts         # Secret redaction for event payloads
└── cli/                  # CLI entry point (commander-based)
    └── index.ts
```

---

## Module Organization

New features follow this pattern:

- **Types first**: Define Zod schemas in `src/types/<feature>.ts`. Export both the schema and the inferred TypeScript type.
- **Repository layer**: If the feature needs Postgres, add a repository class in `src/backend/runtime/<feature>-repository.ts` that takes a `Pool` in its constructor.
- **Service layer**: Business logic goes in `src/backend/runtime/<feature>-service.ts`, wrapping the repository.
- **API layer**: Express route handlers go in `src/backend/api/<feature>.ts` as a factory function returning a `Router`.

Example: the runs feature follows `src/types/run.ts` -> `src/backend/runtime/run-repository.ts` -> `src/backend/runtime/event-service.ts` -> `src/backend/api/runs.ts`.

---

## Naming Conventions

- Files: `kebab-case.ts` (e.g., `run-repository.ts`, `agent-loop.ts`)
- Test files: co-located as `<name>.test.ts` (e.g., `agent-loop.test.ts`)
- Integration tests: `<name>.integration.test.ts`
- Index files: barrel exports via `index.ts` in each directory
- Classes: `PascalCase` (e.g., `RunRepository`, `AgentLoop`)
- Interfaces: `PascalCase`, often prefixed with `I` only for LLM client (`ILLMClient`)
- ID generators: `generate<Entity>Id()` in `src/utils/ids.ts`
- All imports use `.js` extension (required for ESM): `import { logger } from '../../utils/logger.js'`

---

## Examples

- Well-structured API module: `src/backend/api/runs.ts` -- factory function `createRunsRouter(config)` returning an Express `Router`
- Repository pattern: `src/backend/runtime/run-repository.ts` -- class with `Pool` dependency injection
- Type definitions: `src/types/events.ts` -- Zod schemas with discriminated union for all event types
- Utility module: `src/utils/ids.ts` -- pure functions with consistent `prefix_<random>` ID format
