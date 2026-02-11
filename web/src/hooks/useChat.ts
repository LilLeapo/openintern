/**
 * useChat - React hook for chat functionality
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { apiClient } from '../api/client';
import { useSSE } from './useSSE';
import type { ChatMessage } from '../types/events';
import type { RunLLMConfig } from '../api/client';

interface ActiveRunState {
  runId: string;
  sessionKey: string;
}

type MessageMap = Record<string, ChatMessage[]>;
type RunIdMap = Record<string, string | null>;
type ErrorMap = Record<string, Error | null>;

export interface UseChatResult {
  messages: ChatMessage[];
  isRunning: boolean;
  currentRunId: string | null;
  latestRunId: string | null;
  error: Error | null;
  sendMessage: (input: string) => Promise<void>;
  clearMessages: () => void;
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function updateSessionMessages(
  prev: MessageMap,
  targetSessionKey: string,
  updater: (messages: ChatMessage[]) => ChatMessage[],
): MessageMap {
  const currentMessages = prev[targetSessionKey] ?? [];
  return {
    ...prev,
    [targetSessionKey]: updater(currentMessages),
  };
}

export function useChat(sessionKey: string, llmConfig?: RunLLMConfig): UseChatResult {
  const [messagesBySession, setMessagesBySession] = useState<MessageMap>({});
  const [latestRunBySession, setLatestRunBySession] = useState<RunIdMap>({});
  const [errorBySession, setErrorBySession] = useState<ErrorMap>({});
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);

  const streamRunId = activeRun?.runId ?? null;
  const currentRunId = activeRun?.sessionKey === sessionKey ? activeRun.runId : null;
  const isRunning = activeRun?.sessionKey === sessionKey;
  const { events, clearEvents } = useSSE(streamRunId);

  const messages = useMemo(() => messagesBySession[sessionKey] ?? [], [messagesBySession, sessionKey]);
  const latestRunId = latestRunBySession[sessionKey] ?? null;
  const error = errorBySession[sessionKey] ?? null;

  const processedRunIds = useRef<Set<string>>(new Set());
  const streamingMsgId = useRef<string | null>(null);
  const lastProcessedIdx = useRef<number>(0);
  const activeRunRef = useRef<ActiveRunState | null>(null);

  useEffect(() => {
    activeRunRef.current = activeRun;
  }, [activeRun]);

  // Process SSE events to update messages (supports streaming tokens)
  useEffect(() => {
    const currentActiveRun = activeRunRef.current;
    if (!currentActiveRun || events.length === 0) return;
    if (processedRunIds.current.has(currentActiveRun.runId)) return;

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
          setMessagesBySession(prev =>
            updateSessionMessages(prev, currentActiveRun.sessionKey, messages => [
              ...messages,
              {
                id: msgId,
                role: 'assistant',
                content: payload.token,
                timestamp: event.ts,
                runId: currentActiveRun.runId,
              },
            ]),
          );
        } else {
          // Append token to existing streaming message
          const msgId = streamingMsgId.current;
          setMessagesBySession(prev =>
            updateSessionMessages(prev, currentActiveRun.sessionKey, messages =>
              messages.map(message =>
                message.id === msgId
                  ? { ...message, content: message.content + payload.token }
                  : message,
              ),
            ),
          );
        }
      } else if (event.type === 'run.completed') {
        const payload = event.payload as { output: string };
        processedRunIds.current.add(currentActiveRun.runId);
        if (streamingMsgId.current) {
          // Replace streaming message with final output
          const msgId = streamingMsgId.current;
          setMessagesBySession(prev =>
            updateSessionMessages(prev, currentActiveRun.sessionKey, messages =>
              messages.map(message =>
                message.id === msgId
                  ? { ...message, content: payload.output, timestamp: event.ts }
                  : message,
              ),
            ),
          );
        } else {
          // No streaming happened, add complete message
          setMessagesBySession(prev =>
            updateSessionMessages(prev, currentActiveRun.sessionKey, messages => [
              ...messages,
              {
                id: generateId(),
                role: 'assistant',
                content: payload.output,
                timestamp: event.ts,
                runId: currentActiveRun.runId,
              },
            ]),
          );
        }
        setErrorBySession(prev => ({
          ...prev,
          [currentActiveRun.sessionKey]: null,
        }));
        streamingMsgId.current = null;
        lastProcessedIdx.current = 0;
        setActiveRun(null);
        clearEvents();
        return;
      } else if (event.type === 'run.failed') {
        const payload = event.payload as { error: { message: string } };
        processedRunIds.current.add(currentActiveRun.runId);
        const content = `Error: ${payload.error.message}`;
        if (streamingMsgId.current) {
          const msgId = streamingMsgId.current;
          setMessagesBySession(prev =>
            updateSessionMessages(prev, currentActiveRun.sessionKey, messages =>
              messages.map(message =>
                message.id === msgId ? { ...message, content } : message,
              ),
            ),
          );
        } else {
          setMessagesBySession(prev =>
            updateSessionMessages(prev, currentActiveRun.sessionKey, messages => [
              ...messages,
              {
                id: generateId(),
                role: 'assistant',
                content,
                timestamp: event.ts,
                runId: currentActiveRun.runId,
              },
            ]),
          );
        }
        setErrorBySession(prev => ({
          ...prev,
          [currentActiveRun.sessionKey]: new Error(payload.error.message),
        }));
        streamingMsgId.current = null;
        lastProcessedIdx.current = 0;
        setActiveRun(null);
        clearEvents();
        return;
      }
    }
    lastProcessedIdx.current = events.length;
  }, [events, clearEvents]);

  const sendMessage = useCallback(
    async (input: string) => {
      if (!input.trim() || activeRunRef.current) return;

      // Add user message
      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: input,
        timestamp: new Date().toISOString(),
      };
      setMessagesBySession(prev =>
        updateSessionMessages(prev, sessionKey, messages => [...messages, userMessage]),
      );
      setErrorBySession(prev => ({ ...prev, [sessionKey]: null }));

      try {
        const response = await apiClient.createRun(sessionKey, input, llmConfig);
        const nextRun = { runId: response.run_id, sessionKey };
        setActiveRun(nextRun);
        setLatestRunBySession(prev => ({ ...prev, [sessionKey]: response.run_id }));
      } catch (err) {
        setErrorBySession(prev => ({
          ...prev,
          [sessionKey]: err instanceof Error ? err : new Error('Failed to send'),
        }));
      }
    },
    [sessionKey, llmConfig],
  );

  // Reset streaming state when runId changes
  useEffect(() => {
    lastProcessedIdx.current = 0;
    streamingMsgId.current = null;
  }, [streamRunId]);

  const clearMessages = useCallback(() => {
    setMessagesBySession(prev => ({
      ...prev,
      [sessionKey]: [],
    }));
    setLatestRunBySession(prev => ({ ...prev, [sessionKey]: null }));
    setErrorBySession(prev => ({ ...prev, [sessionKey]: null }));
    if (activeRunRef.current?.sessionKey === sessionKey) {
      setActiveRun(null);
      clearEvents();
    }
  }, [sessionKey, clearEvents]);

  return {
    messages,
    isRunning,
    currentRunId,
    latestRunId,
    error,
    sendMessage,
    clearMessages,
  };
}
