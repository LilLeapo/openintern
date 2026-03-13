# OpenIntern Agent (TypeScript)

[简体中文说明](./README.zh-CN.md)

TypeScript replication project inspired by `reference/nanobot`, focused on a compact but extensible agent core.

## Current Capabilities

- Event-driven agent loop (`LLM -> tool calls -> LLM`) with tool iteration guard.
- Async bus and session persistence (JSONL).
- Commands: `/help`, `/new`, `/stop`.
- Memory consolidation:
  - session-isolated long-term memory: `memory/sessions/<session_key>/MEMORY.md`
  - session-isolated history log: `memory/sessions/<session_key>/HISTORY.md`
- Skills discovery and summary injection into system context.
- Built-in tools:
  - `read_file`, `inspect_file`, `read_image`, `write_file`, `edit_file`, `list_dir`
  - `exec`
  - `message`
  - `web_search`, `web_fetch`
  - `cron`
  - `spawn` (subagent)
  - `trigger_workflow`, `query_workflow_status`, `draft_workflow`
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
- Structured trace/debug stream:
  - `run -> iteration -> intent -> tool_call -> approval -> result`
  - optional progress mirroring with agent IDs / names
  - main agent + subagent provenance in the same event model

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
      media.ts
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

The runtime context now uses the local timezone correctly instead of UTC-formatted ISO strings.

Gateway mode with realtime logs:

```bash
pnpm dev -- gateway
```

This starts the background agent runtime and continuously prints inbound/outbound events, subagent activity, approvals, cron, and heartbeat logs to the terminal.

When `agents.trace.mirrorToProgress = true`, CLI progress output can include structured debug lines such as:

```text
↳ [main][iteration] Iteration 1 started.
↳ [research-1#10a3a4db][tool_call] read_image({"path":"docs/images/a.png"})
```

## Frontend Workflow Studio (React + Tailwind)

This repo includes a React + Tailwind runtime dashboard for workflow orchestration:

- Runtime workflow editor (`draft -> publish -> run`)
- HITL approval queue (real approvals from workflow runtime)
- Trace panel (run/node/approval/subagent events)
- Roles/Tools/Skills catalog (runtime read-only)
- Runs panel (active + recent terminal runs)

Run API + Web together:

```bash
pnpm dev:ui
```

Then open the frontend URL from Vite (default: `http://127.0.0.1:5173`).

Module routes:

- `/workflow` for SOP DAG orchestration
- `/runs` for runtime run instances
- `/hitl` for Human-in-the-Loop approval flow
- `/trace` for observability and tracing
- `/registry` for Roles/Tools/Skills catalog

Useful commands:

```bash
pnpm dev:ui:api   # mock API server on 18791
pnpm dev:ui:web   # React web app on 5173
pnpm build:ui     # build React app to src/ui/frontend/dist
```

Notes:

- React app source: `src/ui/frontend`.
- UI API server: `src/ui/server.ts` (runtime-first, mock endpoints kept for compatibility).

## Workflow Engine (Backend Core)

V1 introduces a backend macro-orchestration engine for deterministic DAG execution:

- structured workflow schema (`src/workflow/schema.ts`)
- state-machine runner (`src/workflow/engine.ts`)
- context interpolation + robust JSON output extraction (`src/workflow/interpolation.ts`)
- event-bus bridge via `SUBAGENT_TASK_COMPLETED` / `SUBAGENT_TASK_FAILED`

Current trigger mode is `manual` (API/SDK-driven start).

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

- `GET /api/runtime/events/stream` (SSE unified event stream)
- `GET /api/runtime/hitl/stream` (backward compatible alias)
- `GET /api/runtime/hitl/approvals`
- `POST /api/runtime/hitl/approvals/:approvalId/approve`
- `GET /api/runtime/catalog`
- `GET /api/runtime/workflows/runs`
- `GET /api/runtime/traces`
- `POST /api/runtime/workflows/start`
- `GET /api/runtime/workflow-defs/published`
- `GET /api/runtime/workflow-defs/published/:workflowId`
- `GET /api/runtime/workflow-defs/drafts`
- `GET /api/runtime/workflow-defs/drafts/:draftId`
- `POST /api/runtime/workflow-defs/drafts`
- `PUT /api/runtime/workflow-defs/drafts/:draftId`
- `POST /api/runtime/workflow-defs/publish`
- `GET /api/runtime/workflows/drafts/:draftId`
- `GET /api/runtime/workflows/:runId`
- `POST /api/runtime/workflows/:runId/cancel`

Agent trace/debug events are emitted on the internal bus and can be mirrored to outbound progress without changing the UI.

Workflow repository convention:

- published workflow: `workflows/<workflow_id>.json`
- draft workflow: `workflows/drafts/<draft_id>.json`

Meta-agent workflow tools:

- `trigger_workflow(workflow_id, trigger_input?)`
  - load published workflow and start a run
  - returns `instance_id` (runId), summary, and snapshot
- `query_workflow_status(instance_id)`
  - returns readable summary and full snapshot JSON
- `draft_workflow(instruction, workflow_id?, workflow_json?)`
  - validates against workflow schema
  - saves draft JSON to `workflows/drafts/`
  - returns draft path and review URL (`/workflow?draft=<draft_id>`)

## LLM Config

Minimal example:

```json
{
  "agents": {
    "defaults": {
      "provider": "auto",
      "model": "gpt-4o-mini"
    },
    "trace": {
      "enabled": false,
      "level": "basic",
      "includeSubagents": true,
      "mirrorToProgress": true
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
      "apiKey": "YOUR_MEMU_API_KY",
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
      "webhookPath": "/feishu/events",
      "reactEmoji": "THUMBSUP"
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
- `memory.isolation.tenantId` sets the default enterprise tenant namespace for memory keys.
- `memory.isolation.scopeOwners.chat` defaults to `principal`, so chat memory follows the sender identity.
- `memory.isolation.scopeOwners.papers` defaults to `conversation`, which is safer for document memory unless you explicitly bind a shared `knowledge_base_id`.
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
- `reactEmoji` controls the best-effort reaction added to each received message. Set it to `""` to disable.

Trace/debug notes:

- `agents.trace.enabled = true` turns on structured runtime trace events.
- `agents.trace.level = "basic"` shows lifecycle/tool/result events.
- `agents.trace.level = "verbose"` additionally mirrors intent-style transition text before tool calls.
- `agents.trace.includeSubagents = true` includes spawned subagent traces.
- `agents.trace.mirrorToProgress = true` sends those trace events to normal progress output.

## MemU Tool Behavior

When MemU is enabled, the agent gets three memory tools:

- `memory_retrieve`: query memory by scope (`chat`, `papers`, or `all`).
- `memory_save`: persist selected content into one scope.
- `memory_delete`: clear one scope (requires MemU clear endpoint support).

Scope mapping:

- `chat` scope -> `agent_id = <memory.memu.agentId>:<memory.memu.scopes.chat>`
- `papers` scope -> `agent_id = <memory.memu.agentId>:<memory.memu.scopes.papers>`

OpenIntern now resolves memory identity separately from MemU scope:

- `chat` memory writes default to `tenant:<tenant_id>:principal:<channel>:<sender_id>`
- `papers` memory writes default to `tenant:<tenant_id>:conversation:<channel>:<chat_id>`
- Set message metadata `knowledge_base_id` (or `kb_id`) and configure `memory.isolation.scopeOwners.papers = "knowledgeBase"` to route papers memory into a shared KB namespace.

This keeps scope suffixes (`agent_id`) and ownership boundaries (`user_id`) separate in the same MemU backend.

Example tool calls:

```text
memory_save(content="User prefers concise answers.", scope="chat")
memory_retrieve(query="What are the user's writing preferences?", scope="chat")
memory_retrieve(query="Summarize methods in this paper", scope="papers")
memory_retrieve(query="What should I recall now?", scope="all")
```

If `memory.memu.memorizeMode = "tool"` (default), the system will not auto-memorize each turn; memory is saved only when the model calls `memory_save`.

Local summarized memory is also isolated per session under `memory/sessions/<session_key>/`, instead of a single shared `memory/MEMORY.md`.

## File and Media Reading

`read_file` is now intentionally text-only and rejects binary files. This prevents image/PDF bytes from being pushed back into the LLM context and causing oversized requests.

Recommended flow:

- `inspect_file(path)` to detect file type and choose the next tool.
- `read_file(path)` for text-based files.
- `read_image(path, prompt?)` for PNG/JPG/WebP/GIF image analysis through the configured multimodal provider.

Example:

```text
inspect_file(path="docs/images/diagram.png")
read_image(path="docs/images/diagram.png", prompt="Summarize the chart and extract visible labels.")
```

Tool results are also truncated before they are written back into model context, which reduces the chance of provider-side `input length` errors.

## Upgrade Notes

- Existing `~/.openintern/workspace/TOOLS.md` files are not overwritten automatically.
- After upgrading, restart the running agent process to load new tools.
- If you use `memory_delete`, configure `memory.memu.endpoints.clear` (for example `/clear` on local MemU service).
- If you want trace/debug progress in CLI or chat output, add an `agents.trace` block to `~/.openintern/config.json`.

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
