/**
 * useBlackboard - React hook for blackboard data management
 */

import { useState, useCallback, useEffect } from 'react';
import { apiClient } from '../api/client';
import type { BlackboardMemory, EpisodicType } from '../types';

export interface UseBlackboardResult {
  memories: BlackboardMemory[];
  decisions: BlackboardMemory[];
  evidence: BlackboardMemory[];
  todos: BlackboardMemory[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

function getEpisodicType(memory: BlackboardMemory): EpisodicType | null {
  const meta = memory.metadata;
  if (typeof meta?.episodic_type === 'string') {
    return meta.episodic_type as EpisodicType;
  }
  return null;
}

export function useBlackboard(groupId: string | null): UseBlackboardResult {
  const [memories, setMemories] = useState<BlackboardMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getBlackboard(groupId);
      setMemories(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load blackboard'));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    if (groupId) {
      void refresh();
    } else {
      setMemories([]);
    }
  }, [groupId, refresh]);

  const decisions = memories.filter((m) => getEpisodicType(m) === 'DECISION');
  const evidence = memories.filter((m) => getEpisodicType(m) === 'EVIDENCE');
  const todos = memories.filter((m) => getEpisodicType(m) === 'TODO');

  return {
    memories,
    decisions,
    evidence,
    todos,
    loading,
    error,
    refresh,
  };
}
