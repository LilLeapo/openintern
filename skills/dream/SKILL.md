---
name: dream
description: Manually trigger a dream cycle to consolidate recent conversations into USER.md and MEMORY.md. Use when the user asks to "dream", "consolidate memory", "analyze my chat history", or "learn from conversations".
---

# Dream

The dream service reviews recent conversations across all sessions and extracts lasting insights about the user. Unlike per-session memory consolidation, dream works **cross-session** — it sees patterns that span multiple conversations.

## What It Does

1. Reads all session JSONL files from the last 24 hours
2. Sends them to the LLM for analysis
3. Updates existing workspace files:
   - **USER.md** — enriched with user profile observations (role, preferences, style, expertise)
   - **memory/MEMORY.md** — enriched with durable facts, decisions, and behavioral patterns
   - **memory/HISTORY.md** — appends a timestamped dream cycle entry

No new files are created. Dream consolidates into the files already loaded by every conversation.

## Automatic Schedule

Runs daily via cron (default: 3:00 AM). Configure in `~/.openintern/config.json`:

```json
{
  "memory": {
    "dream": {
      "enabled": true,
      "cronExpression": "0 3 * * *",
      "maxSessionsPerRun": 20
    }
  }
}
```

## Manual Trigger

To check what dream has learned, read the current state:
```
read_file({"path": "<workspace>/USER.md"})
read_file({"path": "<workspace>/memory/MEMORY.md"})
```
