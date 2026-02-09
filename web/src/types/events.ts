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
  StepStartedPayload,
  StepCompletedPayload,
  LLMCalledPayload,
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

// Union type for all events
export type Event =
  | RunStartedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | ToolCalledEvent
  | ToolResultEvent
  | StepStartedEvent
  | StepCompletedEvent
  | LLMCalledEvent;

// API response types
export interface CreateRunResponse {
  run_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
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
}

// Chat message type for UI
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  runId?: string;
}
