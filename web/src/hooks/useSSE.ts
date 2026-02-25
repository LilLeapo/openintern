/**
 * useSSE - React hook for SSE connection
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { SSEClient } from '../api/sse';
import type { Event } from '../types/events';

export interface UseSSEResult {
  events: Event[];
  isConnected: boolean;
  error: Error | null;
  clearEvents: () => void;
}

export function useSSE(runId: string | null): UseSSEResult {
  const [events, setEvents] = useState<Event[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const clientRef = useRef<SSEClient | null>(null);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  useEffect(() => {
    // Start each run with a fresh event buffer.
    setEvents([]);
    setIsConnected(false);
    setError(null);

    if (!runId) {
      return;
    }

    const client = new SSEClient('', {
      onEvent: (event) => {
        setEvents((prev) => [...prev, event]);
      },
      onConnected: () => {
        setIsConnected(true);
        setError(null);
      },
      onError: (err) => {
        setError(err);
      },
      onDisconnected: () => {
        setIsConnected(false);
      },
    });

    clientRef.current = client;
    client.connect(runId);

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [runId]);

  return { events, isConnected, error, clearEvents };
}
