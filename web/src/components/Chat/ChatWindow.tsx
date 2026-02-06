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
}

export function ChatWindow({
  messages,
  onSend,
  isRunning = false,
  error,
}: ChatWindowProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className={styles.chatWindow}>
      <div className={styles.messagesContainer}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <p>Start a conversation with the Agent</p>
          </div>
        ) : (
          messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))
        )}
        {isRunning && (
          <div className={styles.typingIndicator}>
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
