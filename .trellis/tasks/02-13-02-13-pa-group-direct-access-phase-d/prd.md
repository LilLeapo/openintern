# PA Group Direct Access - Phase D

## Goal

Enable users to directly view and intervene in Group discussions from the PA chat interface, providing transparency and control over escalated tasks.

## Background

Phases A, B, and C established the foundation:
- **Phase A**: PA can escalate to groups via `escalate_to_group` tool, enters `waiting` status
- **Phase B**: Intelligent group selection and catalog
- **Phase C**: Permission passthrough and memory separation

**Phase D** completes the user experience by allowing users to:
1. View the Group's discussion thread while PA is waiting
2. Directly post messages into the Group channel
3. Have PA synchronize awareness of user interventions

## Requirements

### Backend

#### 1. Child Run API Endpoints

- **GET /api/runs/:runId/children**
  - Returns array of child runs for a given parent run
  - Include run metadata (id, status, group_id, created_at, etc.)
  - Filter by parent_run_id (column already exists from Phase A)

- **POST /api/runs/:runId/inject**
  - Allow user to inject a message into an active Group run
  - Request body: `{ message: string, role?: string }`
  - Emit event for PA synchronization
  - Return success/error status

#### 2. Run Repository Enhancement

- Add `getChildRuns(parentRunId: string)` method
- Query runs table with `WHERE parent_run_id = ?`

#### 3. Executor Enhancement

- Handle user-injected messages in active Group runs
- Emit events that PA can observe when resuming from `waiting`

### Frontend

#### 1. Type System Updates

- Add `'waiting'` to `RunStatus` type (currently missing)
- Add `parent_run_id?: string` to `RunMeta` interface
- Add `child_runs?: RunMeta[]` for hierarchical display

#### 2. API Client Methods

- `getChildRuns(runId: string): Promise<RunMeta[]>`
- `injectMessage(runId: string, message: string): Promise<void>`

#### 3. PA Chat Integration

**In `useChat` hook:**
- Detect escalation events (`tool.called` with `escalate_to_group`)
- Extract child run ID from tool result
- Handle `waiting` status display
- Provide method to navigate to Group detail view

**In `ChatPage`:**
- Show escalation status indicator when PA is `waiting`
- Display "View Group Discussion" link/button
- Link to new Group detail page

#### 4. Group Detail View (New)

**New page: `GroupRunPage.tsx`**
- Route: `/group-run/:runId`
- Display Group conversation thread with role labels
- Show real-time updates via SSE
- Provide input for user intervention
- Show parent PA run context

**New hook: `useGroupRun.ts`**
- Fetch Group run events
- Subscribe to SSE for real-time updates
- Support message injection
- Handle loading/error states

**New components: `GroupRun/` directory**
- `GroupDiscussionThread.tsx` - Role-labeled message display
- `UserInterventionInput.tsx` - Message input with send button
- `GroupRunHeader.tsx` - Group name, status, parent run link

### Frontend Runtime Optimization

#### 1. Fix `waiting` Status Handling

- Update `RunStatus` type to include `'waiting'`
- Add styling for `waiting` status in `RunCard` and `RunsList`
- Show appropriate UI when PA is waiting for Group completion

#### 2. Escalation Event Processing

- Extend `useChat` SSE processing to handle `tool.called` events
- Extract and store child run information
- Update UI to reflect escalation state

#### 3. Parent-Child Run Awareness

- Add `parent_run_id` to `RunMeta` type
- Display hierarchy in `RunsPage` (indent child runs or group them)
- Add navigation between parent and child runs

#### 4. Group Loading Optimization

- Move group fetching to `AppPreferencesContext` or add caching
- Avoid re-fetching groups on every `ChatPage` mount
- Consider using `useMemo` or `useCallback` for group data

#### 5. Multi-Run SSE Subscription

- Support simultaneous SSE subscriptions for PA run and child Group run
- Or implement multiplexed SSE approach
- Ensure proper cleanup on unmount

## Acceptance Criteria

### Backend
- [ ] `GET /api/runs/:runId/children` returns child runs correctly
- [ ] `POST /api/runs/:runId/inject` successfully injects messages
- [ ] User-injected messages appear in Group run trace
- [ ] PA receives notification of user intervention

### Frontend
- [ ] `RunStatus` type includes `'waiting'`
- [ ] PA chat shows escalation indicator when waiting
- [ ] "View Group Discussion" link navigates to Group detail page
- [ ] Group detail page displays conversation thread with role labels
- [ ] User can post messages into Group channel
- [ ] Real-time updates work in Group detail view
- [ ] Parent-child run relationship visible in UI
- [ ] Group loading is optimized (no redundant fetches)

### Integration
- [ ] User can view Group discussion from PA chat
- [ ] User can intervene in Group discussion
- [ ] PA is aware of user interventions when resuming
- [ ] All lint and type checks pass
- [ ] Manual testing confirms end-to-end flow

## Technical Notes

### Data Model

The `parent_run_id` column already exists from Phase A. No schema changes needed.

### Permission Model

User intervention in Groups must respect the permission intersection from Phase C:
- User's effective permissions in Group = Role permissions ∩ Delegated permissions
- Message injection should validate permissions before allowing

### SSE Architecture

Consider two approaches:
1. **Dual subscription**: PA chat subscribes to both parent and child run SSE
2. **Multiplexed**: Backend sends child run events through parent run SSE stream

Recommend approach 1 for simplicity (separate subscriptions, clean separation of concerns).

### UI/UX Considerations

- Group detail view should clearly indicate it's a child of a PA run
- Provide breadcrumb or back button to return to PA chat
- Show Group status (running, completed, failed) prominently
- Disable intervention input if Group run is completed

### Frontend Optimization Priority

1. **Critical**: Fix `waiting` status handling (blocks Phase D UX)
2. **High**: Escalation event processing (enables Group detail navigation)
3. **Medium**: Parent-child awareness (improves run management)
4. **Low**: Group loading optimization (performance improvement)
5. **Low**: Multi-run SSE (nice-to-have for simultaneous viewing)

## Out of Scope

- Editing or deleting user-injected messages
- Real-time collaboration between multiple users in same Group
- Group run replay or time-travel debugging
- Advanced Group analytics or visualization

## Success Metrics

- Users can successfully view Group discussions from PA chat
- User intervention messages appear in Group trace within 1 second
- PA correctly resumes with awareness of user actions
- No performance degradation in PA chat or Group detail view

## References

- [PA Router Architecture RFC](../../docs/architecture/pa-router-architecture.md) - Section 7 (Phase D), Section 4 (Level 3)
- [Phase A PRD](../02-13-pa-escalation-tool/prd.md) - Data model foundation
- [Phase B PRD](../02-13-pa-intelligent-routing/prd.md) - Group discovery patterns
- [Phase C PRD](../archive/2026-02/02-13-pa-permission-memory-phase-c/prd.md) - Permission model
