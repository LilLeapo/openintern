/**
 * ChatMessage - displays a single chat message
 */

import { useCallback, useState } from 'react';
import type { ChatMessage as ChatMessageType } from '../../types/events';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './Chat.module.css';

export interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const { t } = useLocaleText();
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
          <span className={styles.role}>{isUser ? t('You', '你') : t('Agent', '助手')}</span>
          <div className={styles.messageMeta}>
            <span className={styles.time}>{time}</span>
            <button
              className={styles.copyButton}
              onClick={handleCopy}
              aria-label={t('Copy message', '复制消息')}
            >
              {copied ? t('Copied', '已复制') : t('Copy', '复制')}
            </button>
          </div>
        </div>
        <div className={styles.messageText}>{message.content}</div>
      </div>
    </div>
  );
}
