/**
 * useChat - React hook for chat functionality
 */

import { useState, useCallback, useEffect } from 'react';
import { apiClient } from '../api/client';
import { useSSE } from './useSSE';
import type { ChatMessage } from '../types/events';

export interface UseChatResult {
  messages: ChatMessage[];
  isRunning: boolean;
  currentRunId: string | null;
  error: Error | null;
  sendMessage: (input: string) => Promise<void>;
  clearMessages: () => void;
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function useChat(sessionKey: string): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const { events } = useSSE(currentRunId);

  // Process SSE events to update messages
  useEffect(() => {
    if (!currentRunId || events.length === 0) return;

    const lastEvent = events[events.length - 1];
    if (!lastEvent) return;

    if (lastEvent.type === 'run.completed') {
      const payload = lastEvent.payload as { output: string };
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: 'assistant',
          content: payload.output,
          timestamp: lastEvent.ts,
          runId: currentRunId,
        },
      ]);
      setIsRunning(false);
      setCurrentRunId(null);
    } else if (lastEvent.type === 'run.failed') {
      const payload = lastEvent.payload as { error: { message: string } };
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: 'assistant',
          content: `Error: ${payload.error.message}`,
          timestamp: lastEvent.ts,
          runId: currentRunId,
        },
      ]);
      setIsRunning(false);
      setCurrentRunId(null);
    }
  }, [events, currentRunId]);

  const sendMessage = useCallback(
    async (input: string) => {
      if (!input.trim() || isRunning) return;

      // Add user message
      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: input,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsRunning(true);
      setError(null);

      try {
        const response = await apiClient.createRun(sessionKey, input);
        setCurrentRunId(response.run_id);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to send'));
        setIsRunning(false);
      }
    },
    [sessionKey, isRunning]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setCurrentRunId(null);
    setIsRunning(false);
  }, []);

  return {
    messages,
    isRunning,
    currentRunId,
    error,
    sendMessage,
    clearMessages,
  };
}
