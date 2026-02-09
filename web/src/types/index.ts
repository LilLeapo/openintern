/**
 * Web UI Types - mirrors backend types for frontend use
 */

// Run status
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

// Run metadata
export interface RunMeta {
  run_id: string;
  session_key: string;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  event_count: number;
  tool_call_count: number;
}

// Event types
export type EventType =
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'step.started'
  | 'step.completed'
  | 'llm.called'
  | 'llm.token'
  | 'tool.called'
  | 'tool.result';

// Base event structure
export interface BaseEvent {
  v: 1;
  ts: string;
  session_key: string;
  run_id: string;
  agent_id: string;
  step_id: string;
  span_id: string;
  parent_span_id: string | null;
  redaction: {
    contains_secrets: boolean;
  };
}

// Event payloads
export interface RunStartedPayload {
  input: string;
  config?: Record<string, unknown>;
}

export interface RunCompletedPayload {
  output: string;
  duration_ms: number;
}

export interface RunFailedPayload {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface ToolCalledPayload {
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolResultPayload {
  toolName: string;
  result: unknown;
  isError: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export interface StepStartedPayload {
  stepNumber: number;
}

export interface StepCompletedPayload {
  stepNumber: number;
  resultType: 'tool_call' | 'final_answer' | 'continue';
  duration_ms: number;
}

export interface LLMCalledPayload {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  duration_ms: number;
}

export interface LLMTokenPayload {
  token: string;
  tokenIndex: number;
}
