/**
 * useGroupRun - React hook for viewing a group run's discussion thread
 */

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';
import { useSSE } from './useSSE';
import type { RunMeta } from '../types';
import type { Event } from '../types/events';

export interface GroupRunMessage {
  id: string;
  agentId: string;
  role: string;
  content: string;
  timestamp: string;
  type: Event['type'];
}

export interface UseGroupRunResult {
  run: RunMeta | null;
  parentRun: RunMeta | null;
  messages: GroupRunMessage[];
  loading: boolean;
  error: Error | null;
  isLive: boolean;
  injectMessage: (message: string) => Promise<void>;
  refresh: () => Promise<void>;
}

function extractMessagesFromEvents(events: Event[]): GroupRunMessage[] {
  const messages: GroupRunMessage[] = [];
  for (const event of events) {
    if (event.type === 'llm.token') {
      const payload = event.payload as { token: string };
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.agentId === event.agent_id && lastMsg.type === 'llm.token') {
        lastMsg.content += payload.token;
      } else {
        messages.push({
          id: event.span_id,
          agentId: event.agent_id,
          role: event.agent_id,
          content: payload.token,
          timestamp: event.ts,
          type: event.type,
        });
      }
    } else if (event.type === 'tool.called') {
      const payload = event.payload as { toolName: string; args: Record<string, unknown> };
      messages.push({
        id: event.span_id,
        agentId: event.agent_id,
        role: event.agent_id,
        content: `[Tool: ${payload.toolName}]`,
        timestamp: event.ts,
        type: event.type,
      });
    } else if (event.type === 'tool.result') {
      const payload = event.payload as { toolName: string; result: unknown; isError: boolean };
      const preview = typeof payload.result === 'string'
        ? payload.result.slice(0, 200)
        : JSON.stringify(payload.result).slice(0, 200);
      messages.push({
        id: event.span_id,
        agentId: event.agent_id,
        role: event.agent_id,
        content: `[Result: ${payload.toolName}] ${preview}`,
        timestamp: event.ts,
        type: event.type,
      });
    } else if (event.type === 'run.completed') {
      const payload = event.payload as { output: string };
      messages.push({
        id: event.span_id,
        agentId: event.agent_id,
        role: 'system',
        content: payload.output,
        timestamp: event.ts,
        type: event.type,
      });
    } else if (event.type === 'run.failed') {
      const payload = event.payload as { error: { message: string } };
      messages.push({
        id: event.span_id,
        agentId: event.agent_id,
        role: 'system',
        content: `Error: ${payload.error.message}`,
        timestamp: event.ts,
        type: event.type,
      });
    } else {
      // user.injected events from the inject endpoint (not in the Event union)
      const anyEvent = event as unknown as Record<string, unknown>;
      if (anyEvent['type'] === 'user.injected') {
        const payload = anyEvent['payload'] as { message: string; role: string };
        messages.push({
          id: String(anyEvent['span_id'] ?? `inject_${Date.now()}`),
          agentId: 'user',
          role: payload.role ?? 'user',
          content: payload.message,
          timestamp: String(anyEvent['ts'] ?? new Date().toISOString()),
          type: 'tool.called', // map to a known type for display
        });
      }
    }
  }
  return messages;
}

export function useGroupRun(runId: string | null): UseGroupRunResult {
  const [run, setRun] = useState<RunMeta | null>(null);
  const [parentRun, setParentRun] = useState<RunMeta | null>(null);
  const [historicalMessages, setHistoricalMessages] = useState<GroupRunMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const isLive = run !== null && (run.status === 'running' || run.status === 'waiting' || run.status === 'pending');
  const sseRunId = isLive ? runId : null;
  const { events: sseEvents } = useSSE(sseRunId);

  const loadRun = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    try {
      const [runMeta, events] = await Promise.all([
        apiClient.getRun(runId),
        apiClient.getEvents(runId),
      ]);
      setRun(runMeta);
      setHistoricalMessages(extractMessagesFromEvents(events));

      // Load parent run if exists
      if (runMeta.parent_run_id) {
        try {
          const parent = await apiClient.getRun(runMeta.parent_run_id);
          setParentRun(parent);
        } catch {
          // Parent may not be accessible, ignore
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load group run'));
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void loadRun();
  }, [loadRun]);

  // Merge historical messages with live SSE events
  const liveMessages = extractMessagesFromEvents(sseEvents);
  const seenIds = new Set(historicalMessages.map(m => m.id));
  const newLiveMessages = liveMessages.filter(m => !seenIds.has(m.id));
  const messages = [...historicalMessages, ...newLiveMessages];

  const injectMessage = useCallback(async (message: string) => {
    if (!runId) return;
    try {
      await apiClient.injectMessage(runId, message);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to inject message'));
    }
  }, [runId]);

  return {
    run,
    parentRun,
    messages,
    loading,
    error,
    isLive,
    injectMessage,
    refresh: loadRun,
  };
}
