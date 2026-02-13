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
type RunMode = 'single' | 'group';

interface UseChatConfig {
  llmConfig?: RunLLMConfig;
  runMode?: RunMode;
  groupId?: string | null;
}

export interface EscalationInfo {
  childRunId: string;
  groupId?: string;
  goal?: string;
}

export interface UseChatResult {
  messages: ChatMessage[];
  isRunning: boolean;
  isWaiting: boolean;
  currentRunId: string | null;
  latestRunId: string | null;
  error: Error | null;
  escalation: EscalationInfo | null;
  sendMessage: (input: string) => Promise<void>;
  clearMessages: () => void;
}

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const MESSAGE_STORAGE_KEY = 'openintern.chat.messages.v1';
const RUN_STORAGE_KEY = 'openintern.chat.latest_runs.v1';
const MAX_MESSAGES_PER_SESSION = 200;

function readStoredMessages(): MessageMap {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(MESSAGE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as MessageMap;
  } catch {
    return {};
  }
}

function readStoredLatestRuns(): RunIdMap {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(RUN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as RunIdMap;
  } catch {
    return {};
  }
}

function trimMessageMap(map: MessageMap): MessageMap {
  return Object.fromEntries(
    Object.entries(map).map(([session, messages]) => [
      session,
      messages.slice(-MAX_MESSAGES_PER_SESSION),
    ]),
  );
}

function updateSessionMessages(
  prev: MessageMap,
  targetSessionKey: string,
  updater: (messages: ChatMessage[]) => ChatMessage[],
): MessageMap {
  const currentMessages = prev[targetSessionKey] ?? [];
  const nextMessages = updater(currentMessages).slice(-MAX_MESSAGES_PER_SESSION);
  return {
    ...prev,
    [targetSessionKey]: nextMessages,
  };
}

export function useChat(sessionKey: string, config?: UseChatConfig): UseChatResult {
  const [messagesBySession, setMessagesBySession] = useState<MessageMap>(readStoredMessages);
  const [latestRunBySession, setLatestRunBySession] = useState<RunIdMap>(readStoredLatestRuns);
  const [errorBySession, setErrorBySession] = useState<ErrorMap>({});
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);
  const [escalation, setEscalation] = useState<EscalationInfo | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const runMode = config?.runMode ?? 'single';
  const selectedGroupId = config?.groupId ?? null;
  const llmConfig = config?.llmConfig;

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      MESSAGE_STORAGE_KEY,
      JSON.stringify(trimMessageMap(messagesBySession)),
    );
  }, [messagesBySession]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(latestRunBySession));
  }, [latestRunBySession]);

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
      } else if (event.type === 'tool.called') {
        // Detect escalation events
        const payload = event.payload as { toolName: string; args: Record<string, unknown> };
        if (payload.toolName === 'escalate_to_group') {
          setIsWaiting(true);
        }
      } else if (event.type === 'tool.result') {
        // Extract child run ID from escalation result
        const payload = event.payload as {
          toolName: string;
          result: unknown;
          isError: boolean;
        };
        if (payload.toolName === 'escalate_to_group' && !payload.isError) {
          const result = payload.result as { childRunId?: string; success?: boolean } | string | undefined;
          let childRunId: string | undefined;
          if (result && typeof result === 'object' && 'childRunId' in result) {
            childRunId = result.childRunId;
          } else if (typeof result === 'string') {
            // Try to parse JSON result
            try {
              const parsed = JSON.parse(result) as { childRunId?: string };
              childRunId = parsed.childRunId;
            } catch {
              // not JSON, ignore
            }
          }
          if (childRunId) {
            setEscalation({
              childRunId,
              groupId: undefined,
              goal: undefined,
            });
          }
          // PA is now waiting for group completion; keep isWaiting true
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
        setIsWaiting(false);
        setEscalation(null);
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
        setIsWaiting(false);
        setEscalation(null);
        clearEvents();
        return;
      }
    }
    lastProcessedIdx.current = events.length;
  }, [events, clearEvents]);

  const sendMessage = useCallback(
    async (input: string) => {
      if (!input.trim() || activeRunRef.current) return;
      if (runMode === 'group' && !selectedGroupId) {
        setErrorBySession(prev => ({
          ...prev,
          [sessionKey]: new Error('Group mode requires selecting a group first.'),
        }));
        return;
      }

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
        const response = runMode === 'group' && selectedGroupId
          ? await apiClient.createGroupRun(selectedGroupId, {
              input,
              session_key: sessionKey,
              ...(llmConfig ? { llm_config: llmConfig } : {}),
            })
          : await apiClient.createRun(sessionKey, input, llmConfig);
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
    [sessionKey, llmConfig, runMode, selectedGroupId],
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
    setEscalation(null);
    setIsWaiting(false);
  }, [sessionKey, clearEvents]);

  return {
    messages,
    isRunning,
    isWaiting,
    currentRunId,
    latestRunId,
    error,
    escalation,
    sendMessage,
    clearMessages,
  };
}
