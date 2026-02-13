/**
 * GroupDiscussionThread - displays the group run conversation with role labels
 */

import { useRef, useEffect } from 'react';
import type { GroupRunMessage } from '../../hooks/useGroupRun';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './GroupRun.module.css';

export interface GroupDiscussionThreadProps {
  messages: GroupRunMessage[];
  loading?: boolean;
}

export function GroupDiscussionThread({ messages, loading = false }: GroupDiscussionThreadProps) {
  const { t } = useLocaleText();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (loading) {
    return (
      <div className={styles.thread}>
        <div className={styles.emptyThread}>
          {t('Loading discussion...', '正在加载讨论...')}
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className={styles.thread}>
        <div className={styles.emptyThread}>
          {t('No messages yet.', '暂无消息。')}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.thread}>
      {messages.map((msg) => {
        const isUser = msg.agentId === 'user';
        const isSystem = msg.role === 'system';
        const isTool = msg.type === 'tool.called' || msg.type === 'tool.result';
        const time = new Date(msg.timestamp).toLocaleTimeString();

        let positionClass = '';
        if (isUser) positionClass = styles.fromUser ?? '';
        else if (isSystem) positionClass = styles.fromSystem ?? '';

        return (
          <div
            key={msg.id}
            className={`${styles.threadMessage} ${positionClass} ${isTool ? styles.toolMessage : ''}`}
          >
            <div className={styles.messageLabel}>
              <span className={styles.roleBadge}>
                {isUser ? t('You', '你') : msg.role}
              </span>
              <span className={styles.messageTime}>{time}</span>
            </div>
            <div className={styles.messageBubble}>{msg.content}</div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
