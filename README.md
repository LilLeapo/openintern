# OpenIntern Agent (TypeScript)

TypeScript replication project inspired by `reference/nanobot`, focused on a compact but extensible agent core.

## Current Capabilities

- Event-driven agent loop (`LLM -> tool calls -> LLM`) with tool iteration guard.
- Async bus and session persistence (JSONL).
- Commands: `/help`, `/new`, `/stop`.
- Memory consolidation:
  - long-term memory: `memory/MEMORY.md`
  - history log: `memory/HISTORY.md`
- Skills discovery and summary injection into system context.
- Built-in tools:
  - `read_file`, `write_file`, `edit_file`, `list_dir`
  - `exec`
  - `message`
  - `web_search`, `web_fetch`
  - `cron`
  - `spawn` (subagent)
  - `memory_retrieve`, `memory_save`, `memory_delete` (when MemU is enabled)
- Autonomy pipeline:
  - cron scheduling service
  - heartbeat service
  - subagent background execution + system callback
  - DAG workflow engine (manual trigger, event-bus driven node orchestration)
- Provider layer:
  - OpenAI-compatible API
  - Anthropic-compatible API
  - provider factory with `auto` routing

## Project Structure

```text
src/
  agent/
    context/context-builder.ts
    loop.ts
    memory/
      store.ts
      consolidator.ts
    session/session-store.ts
    skills/loader.ts
    subagent/manager.ts
  bus/
    async-queue.ts
    events.ts
    message-bus.ts
  config/
    schema.ts
    loader.ts
    migrate.ts
  cron/
    types.ts
    service.ts
  heartbeat/
    service.ts
  llm/
    provider.ts
    provider-factory.ts
    openai-compatible-provider.ts
    anthropic-compatible-provider.ts
  tools/
    core/
      json-schema.ts
      tool.ts
      tool-registry.ts
    builtins/
      filesystem.ts
      exec.ts
      message.ts
      web.ts
      cron.ts
      spawn.ts
      memory.ts
  templates/
    defaults.ts
    sync.ts
  cli/
    repl.ts
  index.ts
```

## Quick Start

```bash
pnpm install
pnpm dev
```

First run auto-creates config at `~/.openintern/config.json`.

## Frontend Workflow Studio (React + Tailwind)

This repo now includes a React + Tailwind frontend for workflow orchestration:

- HITL approval switch for high-risk tools
- DAG workflow canvas (node + edge editing with cycle prevention)
- Trace panel for run observability
- Skill/Tool registry UI (register script metadata + JSON Schema)

Run API + Web together:

```bash
pnpm dev:ui
```

Then open the frontend URL from Vite (default: `http://127.0.0.1:5173`).

Module routes:

- `/workflow` for SOP DAG orchestration
- `/hitl` for Human-in-the-Loop approval flow
- `/trace` for observability and tracing
- `/registry` for Skill/Tool registry

Useful commands:

```bash
pnpm dev:ui:api   # mock API server on 18791
pnpm dev:ui:web   # React web app on 5173
pnpm build:ui     # build React app to src/ui/frontend/dist
```

Notes:

- This phase uses mock runtime data (no direct AgentLoop execution yet).
- React app source: `src/ui/frontend`.
- Mock API: `src/ui/server.ts` + `src/ui/mock-state.ts`.

## Workflow Engine (Backend Core)

V1 introduces a backend macro-orchestration engine for deterministic DAG execution:

- structured workflow schema (`src/workflow/schema.ts`)
- state-machine runner (`src/workflow/engine.ts`)
- context interpolation + robust JSON output extraction (`src/workflow/interpolation.ts`)
- event-bus bridge via `SUBAGENT_TASK_COMPLETED` / `SUBAGENT_TASK_FAILED`

Current trigger mode is `manual` (API/SDK-driven start), and this does not replace the UI mock runtime yet.

Workflow schema shape:

```json
{
  "id": "wf_example",
  "trigger": { "type": "manual" },
  "execution": { "mode": "parallel", "maxParallel": 2 },
  "nodes": [
    {
      "id": "node_clean",
      "role": "scientist",
      "skillNames": ["pdf-ingest"],
      "taskPrompt": "Clean {{trigger.csv_path}}",
      "dependsOn": [],
      "outputKeys": ["output_path"],
      "retry": { "maxAttempts": 2, "backoffMs": 200 },
      "hitl": {
        "enabled": true,
        "highRiskTools": ["exec"],
        "approvalTarget": "owner",
        "approvalTimeoutMs": 7200000
      }
    },
    {
      "id": "node_report",
      "role": "scientist",
      "taskPrompt": "Summarize {{node_clean.output_path}}",
      "dependsOn": ["node_clean"],
      "outputKeys": ["summary"]
    }
  ]
}
```

Notes:

- `skillNames` is optional. If omitted, the node still runs with role-based tools.
- Node output must be a JSON object. The engine extracts JSON robustly even when the model adds extra prose.
- HITL supports atomic tool-batch approval: if one tool call in a response is high-risk, the whole batch is gated.
- Workflow-spawned subagents run with isolated origin/session context:
  - `originChannel = "workflow"`
  - `originChatId = "<runId>:<nodeId>"`
  - `sessionKey = "workflow:<runId>:<nodeId>:<attempt>"`

Runtime HITL API (UI server):

- `GET /api/runtime/hitl/stream` (SSE)
- `GET /api/runtime/hitl/approvals`
- `POST /api/runtime/hitl/approvals/:approvalId/approve`
- `POST /api/runtime/workflows/start`
- `GET /api/runtime/workflows/:runId`
- `POST /api/runtime/workflows/:runId/cancel`

## LLM Config

Minimal example:

```json
{
  "agents": {
    "defaults": {
      "provider": "auto",
      "model": "gpt-4o-mini"
    }
  },
  "providers": {
    "openaiCompatible": {
      "apiKey": "YOUR_OPENAI_COMPAT_KEY",
      "apiBase": "https://api.openai.com/v1"
    },
    "anthropicCompatible": {
      "apiKey": "YOUR_ANTHROPIC_KEY",
      "apiBase": "https://api.anthropic.com/v1",
      "anthropicVersion": "2023-06-01"
    }
  },
  "memory": {
    "memu": {
      "enabled": false,
      "apiKey": "YOUR_MEMU_API_KEY",
      "baseUrl": "https://api.memu.so",
      "agentId": "openintern",
      "scopes": {
        "chat": "chat",
        "papers": "papers"
      },
      "timeoutMs": 15000,
      "retrieve": true,
      "memorize": true,
      "memorizeMode": "tool",
      "apiStyle": "cloudV3",
      "endpoints": {}
    }
  },
  "channels": {
    "feishu": {
      "enabled": false,
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "verificationToken": "xxx",
      "encryptKey": "",
      "allowFrom": ["*"],
      "webhookPath": "/feishu/events"
    }
  },
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790
  }
}
```

Provider notes:

- Set `agents.defaults.provider = "openaiCompatible"` to force OpenAI-compatible path.
- Set `agents.defaults.provider = "anthropicCompatible"` to force Anthropic-compatible path.
- In `auto` mode, Claude-like model names prefer `anthropicCompatible` when key exists.
- Set `memory.memu.enabled = true` to enable MemU retrieval and memory tools.
- `memory.memu.memorizeMode = "tool"` (default) enables selective memory via tools only.
- Set `memory.memu.memorizeMode = "auto"` to restore per-turn auto memorize behavior.
- `memory.memu.scopes.chat` and `memory.memu.scopes.papers` control logical scope suffixes.
- For local MemU-style services, set `memory.memu.apiStyle = "localSimple"` and override endpoints, e.g.:

```json
{
  "memory": {
    "memu": {
      "enabled": true,
      "apiStyle": "localSimple",
      "baseUrl": "http://127.0.0.1:8000",
      "apiKey": "local-memu-dev-key",
      "endpoints": {
        "memorize": "/memorize",
        "retrieve": "/recall",
        "clear": "/clear"
      }
    }
  }
}
```

- For local OpenCoWork/Mem0-compatible endpoints (`/api/v1/memories*`), use:

```json
{
  "memory": {
    "memu": {
      "enabled": true,
      "apiStyle": "mem0V1",
      "baseUrl": "http://127.0.0.1:8000",
      "apiKey": "",
      "agentId": "openintern"
    }
  }
}
```

- Set `channels.feishu.enabled = true` to enable Feishu long connection mode (WebSocket via official SDK).
- In Feishu Open Platform:
  - Enable event subscription for `im.message.receive_v1`.
  - Set subscription mode to **Long Connection**.
- No callback URL or public ingress is required in long connection mode.
- `encryptKey` and `verificationToken` are optional in long connection mode.
- `channels.feishu.webhookPath` is kept for compatibility and is ignored in long connection mode.
- `allowFrom` controls sender allowlist (`["*"]` to allow all users).

## MemU Tool Behavior

When MemU is enabled, the agent gets three memory tools:

- `memory_retrieve`: query memory by scope (`chat`, `papers`, or `all`).
- `memory_save`: persist selected content into one scope.
- `memory_delete`: clear one scope (requires MemU clear endpoint support).

Scope mapping:

- `chat` scope -> `agent_id = <memory.memu.agentId>:<memory.memu.scopes.chat>`
- `papers` scope -> `agent_id = <memory.memu.agentId>:<memory.memu.scopes.papers>`

This is logical isolation in the same MemU backend. Reads and writes are separated by scope suffix.

Example tool calls:

```text
memory_save(content="User prefers concise answers.", scope="chat")
memory_retrieve(query="What are the user's writing preferences?", scope="chat")
memory_retrieve(query="Summarize methods in this paper", scope="papers")
memory_retrieve(query="What should I recall now?", scope="all")
```

If `memory.memu.memorizeMode = "tool"` (default), the system will not auto-memorize each turn; memory is saved only when the model calls `memory_save`.

## Upgrade Notes

- Existing `~/.openintern/workspace/TOOLS.md` files are not overwritten automatically.
- After upgrading, restart the running agent process to load new tools.
- If you use `memory_delete`, configure `memory.memu.endpoints.clear` (for example `/clear` on local MemU service).

## Tests

```bash
pnpm typecheck
pnpm test
```

## Enterprise Direction (Planned, Not Implemented Yet)

This project is being planned for company-internal multi-user usage with database-backed memory and RAG.

### Target Architecture

- **Primary DB**: PostgreSQL
- **Vector Search**: `pgvector` (first stage)
- **Object Storage**: MinIO/S3 (original files)
- **Async Jobs**: worker queue for chunking/embedding/session summarization

### Memory and Knowledge Layers

- **Session memory**: short-term context in active session
- **Session summary memory**: periodic summary promoted into user memory
- **User long-term memory**: personal preferences/facts (private scope)
- **Organization knowledge base**: shared docs with ACL

### Multi-user and Security Baseline

- All business data carries `tenant_id`.
- Retrieval must apply ACL filters before ranking.
- User memory and shared knowledge are stored separately.
- Memory writes are versioned and auditable (to avoid silent contamination).

### Planned Milestones

1. DB schema + tenant model + ACL baseline.
2. Document ingestion pipeline + RAG retrieval API.
3. Session-to-memory summarization pipeline.
4. Evaluation/observability dashboards (retrieval quality, hallucination checks).
5. Channel integration and enterprise auth.
