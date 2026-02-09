import type { LLMConfigRequest } from '../../types/api.js';
import type { ScopeContext } from './scope.js';

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RunRecord {
  id: string;
  orgId: string;
  userId: string;
  projectId: string | null;
  sessionKey: string;
  input: string;
  status: RunStatus;
  agentId: string;
  llmConfig: LLMConfigRequest | null;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  cancelledAt: string | null;
}

export interface RunCreateInput {
  id: string;
  scope: ScopeContext;
  sessionKey: string;
  input: string;
  agentId: string;
  llmConfig: LLMConfigRequest | null;
}

export interface EventCursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
