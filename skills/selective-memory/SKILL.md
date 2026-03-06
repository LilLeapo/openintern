---
name: selective-memory
description: Selective memory workflow for choosing when to save, skip, ask, retrieve, or delete memories with memory_retrieve/memory_save/memory_delete. Use when users ask to remember or forget information, tune memory behavior, or separate chat memory from knowledge-base memory.
---

# Selective Memory Workflow

Use `memory_retrieve` before answering when prior memory may help.

Use this decision policy for memory writes:
- `save`: stable preferences, durable facts, explicit user decisions, long-running task context.
- `ask`: sensitive personal data, uncertain facts, or low-confidence extraction.
- `skip`: greetings, one-off chatter, and transient details.

Scope rules:
- Use `scope="chat"` for conversational memory and user preference context.
- Use `scope="papers"` for document or literature knowledge.

Deletion rules:
- Use `memory_delete` only after explicit user intent to clear a scope.
- Confirm which scope will be cleared before calling the tool.

Safety:
- Do not store secrets, credentials, or private identifiers unless user explicitly asks.
- If user asks to stop memory writes, stop using `memory_save`.

