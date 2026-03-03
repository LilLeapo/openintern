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
