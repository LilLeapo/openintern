/**
 * ChatMessage - displays a single chat message
 */

import type { ChatMessage as ChatMessageType } from '../../types/events';
import styles from './Chat.module.css';

export interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const time = new Date(message.timestamp).toLocaleTimeString();

  return (
    <div className={`${styles.message} ${isUser ? styles.user : styles.assistant}`}>
      <div className={styles.messageContent}>
        <div className={styles.messageHeader}>
          <span className={styles.role}>{isUser ? 'You' : 'Agent'}</span>
          <span className={styles.time}>{time}</span>
        </div>
        <div className={styles.messageText}>{message.content}</div>
      </div>
    </div>
  );
}
