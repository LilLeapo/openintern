# Fix Web Chat Context Bug - Maintain Conversation History

## Problem

Web chat doesn't maintain conversation context. Each message creates a separate run with no history, causing the AI to "forget" previous messages in the same conversation.

**User Experience**:
- User: "What is TypeScript?"
- AI: "TypeScript is a typed superset of JavaScript..."
- User: "Can you give me an example?"
- AI: "An example of what?" ❌ (should remember we're talking about TypeScript)

## Root Cause

From research analysis:

1. **Runtime**: `SingleAgentRunner.run()` only accepts `input: string`, starts fresh each time
2. **API**: `CreateRunRequestSchema` only has `input` field, no `messages` array
3. **Frontend**: Maintains messages in state but never sends to backend
4. **Database**: Has `session_key` to group runs, but history is never reconstructed

## Solution: Strategy A (Backend Reconstruction)

Reconstruct conversation history from prior runs in the same session **on the backend**.

### Why Strategy A?

- ✅ Minimal changes (backend only)
- ✅ Server is single source of truth
- ✅ Handles page refresh/reconnect automatically
- ✅ `session_key` already provides grouping
- ✅ No API schema changes needed
- ✅ No frontend changes needed

### Implementation Steps

#### 1. Add history parameter to SingleAgentRunner

**File**: `src/backend/runtime/agent-runner.ts`

- Add `history?: Message[]` to `RunnerContext` interface
- Modify `run()` method line 103 to prepend history:
  ```typescript
  let messages: Message[] = [
    ...(ctx.history ?? []),
    { role: 'user', content: input }
  ];
  ```

#### 2. Reconstruct history in executor

**File**: `src/backend/runtime/executor.ts`

In `executeSingleRun()` (around line 317), before calling `runner.run()`:

1. Query prior completed runs for the same `session_key`:
   ```typescript
   const priorRuns = await runRepository.listRunsBySession(
     scope,
     run.session_key,
     1,
     20 // last 20 runs
   );
   ```

2. Build message history from prior runs:
   ```typescript
   const history: Message[] = [];
   for (const priorRun of priorRuns.runs.reverse()) {
     if (priorRun.run_id === run.run_id) continue; // skip current run
     if (priorRun.status !== 'completed') continue; // only completed runs

     // Add user message
     history.push({ role: 'user', content: priorRun.input });

     // Add assistant response
     if (priorRun.result) {
       history.push({ role: 'assistant', content: priorRun.result });
     }
   }
   ```

3. Pass history to runner:
   ```typescript
   runner.run(run.input, {
     ...ctx,
     history,
   });
   ```

#### 3. Handle history limits

The `PromptComposer` already trims history to last 12 messages (line 101-105), so we don't need to worry about token limits at the executor level. The composer will handle it.

#### 4. Consider memory implications

For very long conversations:
- PromptComposer trims to 12 messages
- CompactionService can summarize older messages
- Memory service provides semantic search for older context

This is already handled by existing infrastructure.

## Acceptance Criteria

- [ ] User can have multi-turn conversations in the same session
- [ ] AI remembers context from previous messages
- [ ] History is limited to prevent token overflow (handled by PromptComposer)
- [ ] Page refresh doesn't break conversation (history from DB)
- [ ] Different sessions remain isolated
- [ ] No API or frontend changes required
- [ ] Existing tests still pass

## Testing Plan

### Manual Testing

1. Start web UI, create new conversation
2. Send: "What is TypeScript?"
3. Wait for response
4. Send: "Can you give me an example?"
5. Verify: AI provides TypeScript example (not "example of what?")
6. Refresh page
7. Send another follow-up question
8. Verify: Context still maintained

### Edge Cases

- Empty session (first message) - should work as before
- Very long conversation - should be trimmed by PromptComposer
- Failed runs in history - should be skipped
- Pending/running runs - should be skipped

## Technical Notes

### Existing Infrastructure (Already Works)

- ✅ `PromptComposer.compose()` accepts `history` and trims to 12 messages
- ✅ LLM clients accept `Message[]` arrays
- ✅ `CompactionService` handles long message arrays
- ✅ `session_key` groups related runs
- ✅ `runRepository.listRunsBySession()` retrieves history

### What We're Adding

- History reconstruction logic in `executor.ts`
- `history` field in `RunnerContext`
- History prepending in `agent-runner.ts`

### Performance Considerations

- Query overhead: One additional DB query per run (listRunsBySession)
- This is acceptable because:
  - Query is indexed on `session_key`
  - Limited to 20 runs
  - Only retrieves metadata (input/result), not full events
  - Benefit (working context) far outweighs cost

## Non-Goals

- ❌ Changing API schema
- ❌ Changing frontend code
- ❌ Adding new database tables
- ❌ Implementing cross-session memory (that's what memory service is for)

## Future Enhancements (Out of Scope)

- Smart history selection (semantic relevance)
- User-controlled history length
- Conversation branching
- History editing/replay
