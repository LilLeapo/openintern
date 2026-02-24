import type { LLMConfigRequest } from '../../types/api.js';
import type { ScopeContext } from './scope.js';

export type RunStatus = 'pending' | 'running' | 'waiting' | 'suspended' | 'completed' | 'failed' | 'cancelled';

/**
 * Permissions delegated from a parent PA run to a child group run.
 * Used to enforce permission intersection: Group Agent permissions = PA permissions ∩ Role permissions.
 */
export interface DelegatedPermissions {
  allowed_tools?: string[];
  denied_tools?: string[];
}

export interface RunRecord {
  id: string;
  orgId: string;
  userId: string;
  projectId: string | null;
  groupId: string | null;
  sessionKey: string;
  input: string;
  status: RunStatus;
  agentId: string;
  llmConfig: LLMConfigRequest | null;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  parentRunId: string | null;
  delegatedPermissions: DelegatedPermissions | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  cancelledAt: string | null;
  suspendedAt: string | null;
  suspendReason: string | null;
}

export interface RunCreateInput {
  id: string;
  scope: ScopeContext;
  sessionKey: string;
  input: string;
  agentId: string;
  groupId?: string;
  llmConfig: LLMConfigRequest | null;
  parentRunId?: string;
  delegatedPermissions?: DelegatedPermissions;
}

export interface EventCursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface RunDependency {
  id: number;
  parentRunId: string;
  childRunId: string;
  toolCallId: string;
  roleId: string | null;
  goal: string;
  status: 'pending' | 'completed' | 'failed';
  result: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
