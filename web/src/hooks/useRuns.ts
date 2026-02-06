/**
 * useRuns - React hook for managing runs list
 */

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';
import type { RunMeta } from '../types';

export interface UseRunsResult {
  runs: RunMeta[];
  loading: boolean;
  error: Error | null;
  total: number;
  page: number;
  loadRuns: (page?: number) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useRuns(sessionKey: string, limit: number = 20): UseRunsResult {
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const loadRuns = useCallback(
    async (newPage: number = 1) => {
      if (!sessionKey) return;

      setLoading(true);
      setError(null);

      try {
        const data = await apiClient.listRuns(sessionKey, newPage, limit);
        setRuns(data.runs);
        setTotal(data.total);
        setPage(newPage);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load runs'));
      } finally {
        setLoading(false);
      }
    },
    [sessionKey, limit]
  );

  const refresh = useCallback(() => {
    return loadRuns(page);
  }, [loadRuns, page]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  return { runs, loading, error, total, page, loadRuns, refresh };
}
