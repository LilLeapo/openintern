# openintern agent loop (TypeScript)

TypeScript implementation of a nanobot-style agent loop:

- inbound/outbound async message bus
- session-based history persistence (JSONL)
- iterative `LLM -> tool calls -> LLM` loop
- slash commands: `/help`, `/new`, `/stop`
- core tools: `read_file`, `write_file`, `edit_file`, `list_dir`, `exec`, `message`

## Project Structure

```text
src/
  agent/
    loop.ts
    context/context-builder.ts
    session/session-store.ts
  bus/
    async-queue.ts
    events.ts
    message-bus.ts
  llm/
    provider.ts
    echo-provider.ts
  tools/
    core/
      json-schema.ts
      tool.ts
      tool-registry.ts
    builtins/
      filesystem.ts
      exec.ts
      message.ts
  utils/
    mutex.ts
  cli/
    repl.ts
  index.ts
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
