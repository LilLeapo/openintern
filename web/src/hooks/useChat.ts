/**
 * useChat - React hook for chat functionality
 */

import { useState, useCallback, useEffect, useRef } from 'react';
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

  const { events, clearEvents } = useSSE(currentRunId);
  const processedRunIds = useRef<Set<string>>(new Set());
  const streamingMsgId = useRef<string | null>(null);
  const lastProcessedIdx = useRef<number>(0);

  // Process SSE events to update messages (supports streaming tokens)
  useEffect(() => {
    if (!currentRunId || events.length === 0) return;
    if (processedRunIds.current.has(currentRunId)) return;

    // Process only new events since last check
    for (let i = lastProcessedIdx.current; i < events.length; i++) {
      const event = events[i];
      if (!event) continue;

      if (event.type === 'llm.token') {
        const payload = event.payload as { token: string };
        if (!streamingMsgId.current) {
          // Create a new streaming assistant message
          const msgId = generateId();
          streamingMsgId.current = msgId;
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              role: 'assistant',
              content: payload.token,
              timestamp: event.ts,
              runId: currentRunId,
            },
          ]);
        } else {
          // Append token to existing streaming message
          const msgId = streamingMsgId.current;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? { ...m, content: m.content + payload.token }
                : m,
            ),
          );
        }
      } else if (event.type === 'run.completed') {
        const payload = event.payload as { output: string };
        processedRunIds.current.add(currentRunId);
        if (streamingMsgId.current) {
          // Replace streaming message with final output
          const msgId = streamingMsgId.current;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? { ...m, content: payload.output, timestamp: event.ts }
                : m,
            ),
          );
        } else {
          // No streaming happened, add complete message
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant',
              content: payload.output,
              timestamp: event.ts,
              runId: currentRunId,
            },
          ]);
        }
        streamingMsgId.current = null;
        lastProcessedIdx.current = 0;
        setIsRunning(false);
        setCurrentRunId(null);
        clearEvents();
        return;
      } else if (event.type === 'run.failed') {
        const payload = event.payload as { error: { message: string } };
        processedRunIds.current.add(currentRunId);
        const content = `Error: ${payload.error.message}`;
        if (streamingMsgId.current) {
          const msgId = streamingMsgId.current;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId ? { ...m, content } : m,
            ),
          );
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant',
              content,
              timestamp: event.ts,
              runId: currentRunId,
            },
          ]);
        }
        streamingMsgId.current = null;
        lastProcessedIdx.current = 0;
        setIsRunning(false);
        setCurrentRunId(null);
        clearEvents();
        return;
      }
    }
    lastProcessedIdx.current = events.length;
  }, [events, currentRunId, clearEvents]);

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

  // Reset streaming state when runId changes
  useEffect(() => {
    lastProcessedIdx.current = 0;
    streamingMsgId.current = null;
  }, [currentRunId]);

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
