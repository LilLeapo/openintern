/**
 * ChatWindow - main chat container component
 */

import { useRef, useEffect } from 'react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import type { ChatMessage as ChatMessageType } from '../../types/events';
import { useLocaleText } from '../../i18n/useLocaleText';
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
  const { t } = useLocaleText();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className={styles.chatWindow}>
      <div className={styles.chatToolbar}>
        <div className={styles.chatToolbarInfo}>
          <span className={styles.toolbarTitle}>{t('Conversation', '会话')}</span>
          <span className={styles.toolbarMeta}>
            {t(`${messages.length} messages`, `${messages.length} 条消息`)}
          </span>
        </div>
        <div className={styles.chatToolbarActions}>
          {latestRunId && onOpenRun && (
            <button className={styles.secondaryButton} onClick={onOpenRun}>
              {t('Open Last Trace', '打开最近追踪')}
            </button>
          )}
          {onClear && (
            <button
              className={styles.ghostButton}
              onClick={onClear}
              disabled={messages.length === 0}
            >
              {t('Clear', '清空')}
            </button>
          )}
        </div>
      </div>
      <div className={styles.messagesContainer}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <p>{t('Start a conversation with the Agent', '开始与助手对话')}</p>
            <p className={styles.emptyStateHint}>
              {t(
                'Ask for implementation plans, debugging steps, or run analysis.',
                '你可以让它给出实现方案、排障步骤或任务分析。',
              )}
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
            <span>{t('Agent is thinking...', '助手正在思考...')}</span>
          </div>
        )}
        {error && (
          <div className={styles.errorMessage}>
            {t('Error:', '错误：')} {error.message}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <ChatInput
        onSend={onSend}
        disabled={isRunning}
        placeholder={isRunning ? t('Waiting for response...', '等待回复中...') : t('Type a message...', '输入消息...')}
      />
    </div>
  );
}
