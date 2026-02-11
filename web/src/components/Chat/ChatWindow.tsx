/**
 * ChatWindow - main chat container component
 */

import { useRef, useEffect } from 'react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import type { ChatMessage as ChatMessageType } from '../../types/events';
import styles from './Chat.module.css';

export interface ChatWindowProps {
  messages: ChatMessageType[];
  onSend: (message: string) => void;
  isRunning?: boolean;
  error?: Error | null;
  onClear?: () => void;
  onOpenRun?: () => void;
  latestRunId?: string | null;
}

export function ChatWindow({
  messages,
  onSend,
  isRunning = false,
  error,
  onClear,
  onOpenRun,
  latestRunId,
}: ChatWindowProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className={styles.chatWindow}>
      <div className={styles.chatToolbar}>
        <div className={styles.chatToolbarInfo}>
          <span className={styles.toolbarTitle}>Conversation</span>
          <span className={styles.toolbarMeta}>{messages.length} messages</span>
        </div>
        <div className={styles.chatToolbarActions}>
          {latestRunId && onOpenRun && (
            <button className={styles.secondaryButton} onClick={onOpenRun}>
              Open Last Trace
            </button>
          )}
          {onClear && (
            <button
              className={styles.ghostButton}
              onClick={onClear}
              disabled={messages.length === 0}
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <div className={styles.messagesContainer}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <p>Start a conversation with the Agent</p>
            <p className={styles.emptyStateHint}>
              Ask for implementation plans, debugging steps, or run analysis.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))
        )}
        {isRunning && (
          <div className={styles.typingIndicator} aria-live="polite">
            <span className={styles.pulsingDot} />
            <span>Agent is thinking...</span>
          </div>
        )}
        {error && (
          <div className={styles.errorMessage}>
            Error: {error.message}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <ChatInput
        onSend={onSend}
        disabled={isRunning}
        placeholder={isRunning ? 'Waiting for response...' : 'Type a message...'}
      />
    </div>
  );
}
