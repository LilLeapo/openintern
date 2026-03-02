# openintern agent loop (TypeScript)

TypeScript implementation of a nanobot-style agent loop:

- inbound/outbound async message bus
- session-based history persistence (JSONL)
- iterative `LLM -> tool calls -> LLM` loop
- slash commands: `/help`, `/new`, `/stop`
- memory consolidation: `memory/MEMORY.md` + `memory/HISTORY.md`
- skills summary + always-on skills loading
- core tools: `read_file`, `write_file`, `edit_file`, `list_dir`, `exec`, `message`, `web_search`, `web_fetch`
- OpenAI-compatible provider and config-driven startup

## Project Structure

```text
src/
  agent/
    memory/
      store.ts
      consolidator.ts
    skills/
      loader.ts
    loop.ts
    context/context-builder.ts
    session/session-store.ts
  bus/
    async-queue.ts
    events.ts
    message-bus.ts
  config/
    schema.ts
    loader.ts
    migrate.ts
  llm/
    provider.ts
    provider-factory.ts
    openai-compatible-provider.ts
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
  templates/
    defaults.ts
    sync.ts
  utils/
    mutex.ts
  cli/
    repl.ts
  index.ts
```

## Config

On first run, config is created at `~/.openintern/config.json`.

Set at least:

```json
{
  "providers": {
    "openaiCompatible": {
      "apiKey": "YOUR_KEY",
      "apiBase": "https://api.openai.com/v1"
    }
  },
  "agents": {
    "defaults": {
      "model": "gpt-4o-mini"
    }
  }
}
```

## Run

```bash
pnpm install
pnpm dev
```

## Test

```bash
pnpm test
```
