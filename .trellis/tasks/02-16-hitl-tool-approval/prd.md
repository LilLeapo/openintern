# Human-in-the-loop (HITL) Tool Approval Flow

## Goal

Implement a Human-in-the-loop approval system for high-risk tools to prevent silent execution of dangerous operations (email sending, data deletion, financial transactions, etc.). When a tool requires approval, the agent run should pause and wait for explicit user approval or rejection before proceeding.

## Background

The codebase already has the foundation:
- `ToolPolicy` class with three-state decision: `allow`, `deny`, `ask`
- Event types `tool.blocked` and `tool.requires_approval` defined but never emitted
- Run status `waiting` already exists and is used for escalation flows
- SSE infrastructure for real-time event broadcasting to frontend

**Current Gap**: The `ask` decision is currently treated the same as `deny` - tools are blocked but the user has no way to approve them.

## Requirements

### Backend

1. **Distinguish `ask` from `deny` in tool execution**
   - Modify `RuntimeToolRouter.callTool()` to return `{ success: false, requiresApproval: true }` for `ask` decisions
   - Keep `{ success: false, blocked: true }` for `deny` decisions

2. **Emit `tool.requires_approval` events**
   - When a tool returns `requiresApproval: true`, emit a `tool.requires_approval` event with:
     - `tool_name`
     - `tool_call_id`
     - `args`
     - `risk_level` (from policy decision)
     - `reason` (why approval is needed)
   - Transition run to `waiting` status
   - Broadcast event via SSE to connected clients

3. **API endpoints for approval/rejection**
   - `POST /api/runs/:run_id/approve`
     - Body: `{ tool_call_id: string }`
     - Validates run ownership via `resolveRequestScope`
     - Verifies run is in `waiting` status
     - Emits `tool.approved` event
     - Resumes run execution
     - Returns `{ success: true, run_id, tool_call_id }`

   - `POST /api/runs/:run_id/reject`
     - Body: `{ tool_call_id: string, reason?: string }`
     - Validates run ownership via `resolveRequestScope`
     - Verifies run is in `waiting` status
     - Emits `tool.rejected` event with rejection reason
     - Fails the tool call with rejection error
     - Resumes run execution (agent can handle the failure)
     - Returns `{ success: true, run_id, tool_call_id }`

4. **Pause and resume mechanism**
   - When `tool.requires_approval` is emitted, store pending approval state
   - Agent loop waits for approval signal before continuing
   - On approve: execute the tool and return result
   - On reject: return error result to agent

5. **Event types to add**
   - `tool.approved` - emitted when user approves
   - `tool.rejected` - emitted when user rejects

### Frontend

1. **Event handling in `useChat` hook**
   - Add handler for `tool.requires_approval` events
   - Store pending approval state: `{ toolCallId, toolName, args, riskLevel, reason }`
   - Expose approval state and actions to UI

2. **Approval UI component**
   - Create `ApprovalCard.tsx` component showing:
     - Tool name and description
     - Tool arguments (formatted, potentially truncated)
     - Risk level indicator (color-coded)
     - Reason why approval is needed
     - Two action buttons: "Approve" and "Reject"
   - On approve: call API and clear pending state
   - On reject: show optional reason input, call API, clear pending state

3. **Integration in ChatWindow**
   - Render `ApprovalCard` when pending approval exists
   - Position prominently (similar to escalation banner pattern)
   - Disable chat input while approval is pending (optional UX decision)

4. **API client methods**
   - Add `approveToolCall(runId: string, toolCallId: string)`
   - Add `rejectToolCall(runId: string, toolCallId: string, reason?: string)`

5. **Type definitions**
   - Add `ToolRequiresApprovalEvent` to frontend event types
   - Add `ToolApprovedEvent` and `ToolRejectedEvent` types

## Acceptance Criteria

### Backend
- [ ] `RuntimeToolRouter.callTool()` distinguishes `ask` from `deny`
- [ ] `tool.requires_approval` events are emitted when tool needs approval
- [ ] Run transitions to `waiting` status when approval needed
- [ ] `POST /api/runs/:run_id/approve` endpoint works correctly
- [ ] `POST /api/runs/:run_id/reject` endpoint works correctly
- [ ] Agent loop pauses and waits for approval signal
- [ ] On approve, tool executes and returns result
- [ ] On reject, tool returns error and agent continues
- [ ] All events are broadcast via SSE

### Frontend
- [ ] `useChat` hook handles `tool.requires_approval` events
- [ ] `ApprovalCard` component renders with tool details
- [ ] Approve button calls API and clears pending state
- [ ] Reject button calls API with optional reason
- [ ] Approval card is visible in ChatWindow
- [ ] Event types are properly defined in frontend

### Integration
- [ ] End-to-end flow works: tool requires approval → UI shows card → user approves → tool executes → result shown
- [ ] End-to-end flow works: tool requires approval → UI shows card → user rejects → agent receives error → continues
- [ ] Multiple approval requests are handled correctly (queue or sequential)
- [ ] SSE events are received in real-time

## Technical Notes

### Architectural Decisions

1. **Event-only approach (no new table)**
   - Store pending approval state in memory or in events table
   - Simpler than creating a dedicated `tool_approvals` table
   - Approval state is ephemeral - only matters during run execution

2. **Pause mechanism**
   - Use Promise + resolver pattern: when approval needed, create a Promise and store its resolver
   - Approve/reject endpoints resolve the Promise
   - Tool scheduler awaits the Promise before continuing
   - Alternative: polling approach (like escalation service) - simpler but less efficient

3. **Error handling**
   - If run is cancelled while waiting for approval, clean up pending state
   - If user rejects, return clear error message to agent
   - Handle timeout scenario (optional: auto-reject after N minutes)

4. **Multiple approvals**
   - If multiple tools need approval in parallel batch, handle each separately
   - Store map of `toolCallId -> Promise resolver`
   - UI shows all pending approvals (or one at a time with queue)

### Files to Modify

**Backend:**
- `src/backend/api/runs.ts` - add approve/reject endpoints
- `src/backend/runtime/tool-router.ts` - distinguish ask from deny
- `src/backend/runtime/tool-scheduler.ts` - emit events and pause
- `src/backend/runtime/executor.ts` - handle approval wait/resume
- `src/types/events.ts` - add tool.approved and tool.rejected event types
- `src/types/agent.ts` - add requiresApproval field to ToolResult

**Frontend:**
- `web/src/hooks/useChat.ts` - add event handler
- `web/src/components/Chat/ChatWindow.tsx` - render approval card
- `web/src/components/Chat/ApprovalCard.tsx` - new component
- `web/src/api/client.ts` - add API methods
- `web/src/types/events.ts` - add event types
- `web/src/types/index.ts` - add event type strings

### Code Patterns to Follow

- API endpoint pattern: follow `POST /api/runs/:run_id/cancel` (lines 361-405 in runs.ts)
- Event emission: follow `POST /api/runs/:run_id/inject` (lines 306-359 in runs.ts)
- SSE broadcasting: use `SSEManager.broadcastToRun(runId, event)`
- Frontend event handling: follow existing pattern in `useChat.ts` (lines 137-296)
- Component structure: follow `ToolCallCard.tsx` pattern

### Testing Strategy

1. **Unit tests**
   - Test approve/reject endpoints with valid/invalid inputs
   - Test tool policy decision handling
   - Test event emission

2. **Integration tests**
   - Test full approval flow with real agent run
   - Test rejection flow
   - Test timeout/cancellation scenarios

3. **Manual testing**
   - Create a test tool that requires approval
   - Verify UI shows approval card
   - Test approve and reject flows
   - Verify SSE events are received

## Out of Scope

- Approval history/audit log (can be added later)
- Approval delegation (assign to another user)
- Approval policies (auto-approve based on rules)
- Timeout with auto-reject (can be added later)
- Approval notifications (email/Slack when approval needed)

## Success Metrics

- High-risk tools never execute without explicit user approval
- Approval flow completes in < 5 seconds from user action
- Zero silent failures or bypasses of approval system
- Clear error messages when approval is rejected
