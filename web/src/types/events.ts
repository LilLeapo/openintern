/**
 * Event type definitions - continued from index.ts
 */

import type {
  BaseEvent,
  RunStartedPayload,
  RunCompletedPayload,
  RunFailedPayload,
  ToolCalledPayload,
  ToolResultPayload,
  ToolRequiresApprovalPayload,
  ToolApprovedPayload,
  ToolRejectedPayload,
  StepStartedPayload,
  StepCompletedPayload,
  LLMCalledPayload,
  LLMTokenPayload,
} from './index';

// Specific event types
export interface RunStartedEvent extends BaseEvent {
  type: 'run.started';
  payload: RunStartedPayload;
}

export interface RunCompletedEvent extends BaseEvent {
  type: 'run.completed';
  payload: RunCompletedPayload;
}

export interface RunFailedEvent extends BaseEvent {
  type: 'run.failed';
  payload: RunFailedPayload;
}

export interface ToolCalledEvent extends BaseEvent {
  type: 'tool.called';
  payload: ToolCalledPayload;
}

export interface ToolResultEvent extends BaseEvent {
  type: 'tool.result';
  payload: ToolResultPayload;
}

export interface ToolRequiresApprovalEvent extends BaseEvent {
  type: 'tool.requires_approval';
  payload: ToolRequiresApprovalPayload;
}

export interface ToolApprovedEvent extends BaseEvent {
  type: 'tool.approved';
  payload: ToolApprovedPayload;
}

export interface ToolRejectedEvent extends BaseEvent {
  type: 'tool.rejected';
  payload: ToolRejectedPayload;
}

export interface StepStartedEvent extends BaseEvent {
  type: 'step.started';
  payload: StepStartedPayload;
}

export interface StepCompletedEvent extends BaseEvent {
  type: 'step.completed';
  payload: StepCompletedPayload;
}

export interface LLMCalledEvent extends BaseEvent {
  type: 'llm.called';
  payload: LLMCalledPayload;
}

export interface LLMTokenEvent extends BaseEvent {
  type: 'llm.token';
  payload: LLMTokenPayload;
}

// Union type for all events
export type Event =
  | RunStartedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | ToolCalledEvent
  | ToolResultEvent
  | ToolRequiresApprovalEvent
  | ToolApprovedEvent
  | ToolRejectedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | LLMCalledEvent
  | LLMTokenEvent;

// API response types
export interface CreateRunResponse {
  run_id: string;
  status: 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
}

export interface ListRunsResponse {
  runs: import('./index').RunMeta[];
  total: number;
  page: number;
  limit: number;
}

export interface GetRunEventsResponse {
  events: Event[];
  total: number;
  next_cursor?: string | null;
}

// Chat message type for UI
export interface ChatMessageAttachment {
  upload_id: string;
  original_name: string;
  mime_type: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  runId?: string;
  attachments?: ChatMessageAttachment[];
}
