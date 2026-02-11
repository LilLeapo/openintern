/**
 * ChatMessage - displays a single chat message
 */

import { useCallback, useState } from 'react';
import type { ChatMessage as ChatMessageType } from '../../types/events';
import styles from './Chat.module.css';

export interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const time = new Date(message.timestamp).toLocaleTimeString();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(message.content);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }, [message.content]);

  return (
    <div className={`${styles.message} ${isUser ? styles.user : styles.assistant}`}>
      <div className={styles.messageContent}>
        <div className={styles.messageHeader}>
          <span className={styles.role}>{isUser ? 'You' : 'Agent'}</span>
          <div className={styles.messageMeta}>
            <span className={styles.time}>{time}</span>
            <button
              className={styles.copyButton}
              onClick={handleCopy}
              aria-label="Copy message"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <div className={styles.messageText}>{message.content}</div>
      </div>
    </div>
  );
}
