/**
 * UserInterventionInput - input for injecting messages into a group run
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { KeyboardEvent, ChangeEvent } from 'react';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './GroupRun.module.css';

export interface UserInterventionInputProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
}

export function UserInterventionInput({ onSend, disabled = false }: UserInterventionInputProps) {
  const { t } = useLocaleText();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const target = textareaRef.current;
    if (!target) return;
    target.style.height = 'auto';
    const nextHeight = Math.min(target.scrollHeight, 100);
    target.style.height = `${nextHeight}px`;
  }, [value]);

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || disabled || sending) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setValue('');
    } finally {
      setSending(false);
    }
  }, [value, disabled, sending, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  if (disabled) {
    return (
      <div className={styles.disabledNotice}>
        {t(
          'This group run has finished. You can no longer send messages.',
          '此团队讨论已结束，无法继续发送消息。',
        )}
      </div>
    );
  }

  return (
    <div className={styles.interventionBar}>
      <textarea
        ref={textareaRef}
        className={styles.interventionInput}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={t('Send a message to the group...', '向团队发送消息...')}
        disabled={sending}
        rows={1}
        maxLength={2000}
        aria-label={t('Intervention message', '干预消息')}
      />
      <button
        className={styles.interventionSend}
        onClick={() => void handleSend()}
        disabled={sending || !value.trim()}
      >
        {sending ? t('Sending...', '发送中...') : t('Send', '发送')}
      </button>
      <div className={styles.interventionHint}>
        {t('Enter to send · Shift+Enter for newline', 'Enter 发送 · Shift+Enter 换行')}
      </div>
    </div>
  );
}
