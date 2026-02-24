# OpenIntern

A production-grade, multi-tenant AI Agent Runtime. Provides agent execution, event tracing, team orchestration, and a three-tier memory system — all backed by PostgreSQL.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Web UI (React + Vite)                  │
│           Chat / Runs / Trace / Team / Blackboard        │
└───────────────────────┬──────────────────────────────────┘
                        │ REST + SSE
┌───────────────────────┴──────────────────────────────────┐
│                   Backend (Express + TypeScript)          │
│                                                          │
│  Run Queue ─→ Agent Runner (step loop) ─→ Tool Router   │
│       │            │                          │          │
│       │      Checkpoint Service         MCP / Built-in  │
│       │            │                                     │
│  Orchestrator ─→ Swarm Coordinator (group runs)         │
│       │                                                  │
│  Memory Service (core / episodic / archival)            │
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────┴──────────────────────────────────┐
│              PostgreSQL + pgvector + pgcrypto             │
└──────────────────────────────────────────────────────────┘
```

## Features

- **Multi-tenant isolation** — scoped by `org_id` / `user_id` / `project_id` across all data
- **Run execution engine** — serial queue, step-level checkpoints, suspension & resumption
- **Event sourcing** — every action recorded as typed events, real-time SSE streaming
- **Three-tier memory** — Core (identity) / Episodic (conversation) / Archival (knowledge), hybrid search via pgvector + Postgres FTS
- **Team orchestration** — roles, groups, serial orchestrator, blackboard collaboration, dynamic swarm coordination
- **Multi-LLM support** — OpenAI, Anthropic, Gemini providers with unified interface
- **Tool ecosystem** — built-in tools (memory, file, coding, export), MCP protocol (stdio), tool policies (allow/block), high-risk operation blocking
- **Plugin system** — extensible integration layer (Feishu docs, MinerU PDF ingestion)
- **Skill registry** — loadable skill definitions that inject into agent prompts
- **Three interfaces** — Web UI (React), CLI (commander), REST API

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20+ / TypeScript / Express |
| Database | PostgreSQL 15+ / pgvector / pgcrypto |
| Frontend | React 18 / TypeScript / Vite |
| MCP Server | Python 3.9+ (stdio protocol) |
| Validation | Zod (runtime schema validation) |
| Testing | Vitest / Playwright / pytest |

## Quick Start

### Prerequisites

- Node.js >= 20, pnpm >= 8
- PostgreSQL >= 15 with `vector` and `pgcrypto` extensions
- Python >= 3.9 (only if using MCP tools)

### Install

```bash
# Backend + CLI
pnpm install

# Frontend
pnpm --dir web install

# Python MCP (optional)
cd python && pip3 install -e . && cd ..
```

### Configure

```bash
# Required: database connection
export DATABASE_URL='postgres://user:pass@127.0.0.1:5432/openintern'

# Generate config file
pnpm cli init
```

Database tables are auto-migrated on first startup.

### Run

```bash
# Backend (dev mode, port 3000)
pnpm cli dev

# Frontend (new terminal, port 5173)
pnpm --dir web dev
```

Docker Compose is also available — see `docker-compose.example.yml`.

## CLI

```bash
pnpm cli init                              # Generate agent.config.json
pnpm cli dev                               # Start dev server
pnpm cli run "your prompt" --session demo  # Execute an agent run
pnpm cli run "your prompt" --stream        # Stream output in real-time
pnpm cli tail <run_id>                     # Tail events for a run
pnpm cli export <run_id> --format json     # Export trace
pnpm cli skills list                       # List available skills
pnpm cli doctor                            # Health check
```

## Web UI

| Page | Path | Description |
|------|------|-------------|
| Chat | `/` | Conversational agent interface |
| Runs | `/runs` | Execution history |
| Trace | `/trace/:runId` | Step-by-step run trace |
| Team | `/orchestrator` | Role and group management |
| Blackboard | `/blackboard/:groupId` | Team collaboration board |
| Skills | `/skills` | Skill management |

## API

### Multi-tenancy

Pass tenant scope via HTTP headers:

```bash
curl -H "x-org-id: my-org" \
     -H "x-user-id: my-user" \
     -H "x-project-id: my-project" \
     http://localhost:3000/api/runs
```

CLI uses env vars: `AGENT_ORG_ID`, `AGENT_USER_ID`, `AGENT_PROJECT_ID`.

### Endpoints

**Runs**

```
POST   /api/runs                          # Create a run
GET    /api/runs/:run_id                  # Get run details
GET    /api/runs/:run_id/events           # Query run events
GET    /api/runs/:run_id/stream           # SSE event stream
POST   /api/runs/:run_id/cancel           # Cancel a run
GET    /api/sessions/:session_key/runs    # List runs by session
```

**Roles & Groups**

```
POST|GET          /api/roles              # Create / list roles
GET|PUT|DELETE    /api/roles/:id          # CRUD single role
POST|GET          /api/groups             # Create / list groups
GET|PUT|DELETE    /api/groups/:id         # CRUD single group
POST|GET          /api/groups/:id/members # Manage group members
POST              /api/groups/:id/runs    # Create group run
```

**Blackboard & Skills**

```
GET|POST  /api/groups/:id/blackboard      # List / create blackboard memories
POST|GET  /api/skills                     # Create / list skills
```

### Event Types

| Type | Description |
|------|-------------|
| `run.started` / `run.completed` / `run.failed` | Run lifecycle |
| `step.started` / `step.completed` | Step execution |
| `llm.called` / `llm.token` | LLM invocation and streaming tokens |
| `tool.called` / `tool.result` / `tool.blocked` | Tool execution |
| `message.task` / `message.proposal` / `message.decision` | Orchestration messages |
| `message.evidence` / `message.status` | Collaboration messages |

## Configuration

Generated via `pnpm cli init` → `agent.config.json`. Priority: config file < env vars < CLI flags < API request params.

### Key Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | (required) |
| `PORT` | Backend server port | `3000` |
| `LLM_PROVIDER` | `openai` / `anthropic` / `gemini` | `openai` |
| `LLM_MODEL` | Model name | — |
| `LLM_API_KEY` | Provider API key | — |
| `OPENAI_API_KEY` | OpenAI-specific key | — |
| `ANTHROPIC_API_KEY` | Anthropic-specific key | — |
| `VITE_API_PROXY_TARGET` | Frontend API proxy target | — |

## Project Structure

```
src/
├── backend/
│   ├── api/              # Express route handlers
│   ├── agent/            # LLM clients (OpenAI, Anthropic, Gemini), MCP client
│   ├── db/               # PostgreSQL connection, migrations, schema
│   ├── queue/            # Serial run queue
│   ├── runtime/          # Core execution engine
│   │   ├── executor/     # Single-run and group-run execution
│   │   ├── integrations/ # Feishu, MinerU integrations
│   │   ├── plugin/       # Plugin abstraction layer
│   │   ├── skill/        # Skill registry and loader
│   │   └── tools/        # Built-in tools (memory, file, coding, export)
│   └── store/            # Data access (events, memory, vectors, embeddings)
├── cli/                  # CLI commands (dev, run, tail, export, doctor)
├── config/               # Config loader
├── types/                # Shared Zod schemas and type definitions
└── utils/                # ID generation, errors, logger
web/
├── src/
│   ├── api/              # API client + SSE helper
│   ├── components/       # React components
│   ├── pages/            # Page-level components
│   ├── hooks/            # Custom React hooks
│   ├── context/          # React context providers
│   └── i18n/             # Internationalization
└── e2e/                  # Playwright E2E tests
python/                   # Optional MCP server (stdio protocol)
```

## Development

```bash
# Type checking
pnpm typecheck
pnpm --dir web typecheck

# Linting
pnpm lint
pnpm --dir web lint

# Backend tests
pnpm test

# Frontend tests
pnpm --dir web test

# E2E tests (install browsers first: pnpm --dir web exec playwright install chromium)
pnpm --dir web test:e2e

# Python MCP tests
cd python && pytest
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `DATABASE_URL is required` | Set `export DATABASE_URL='postgres://...'` |
| `CREATE EXTENSION vector` permission error | Grant superuser or have DBA pre-install `vector` and `pgcrypto` |
| SSE returns 400/404 | Scope mismatch — ensure `org/user/project` headers match the run's scope |
| MCP tools unavailable | Install Python package (`cd python && pip3 install -e .`) and start with `--mcp-stdio` |

## License

TBD
