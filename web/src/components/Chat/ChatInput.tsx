/**
 * ChatInput - input component for sending messages
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, ChangeEvent } from 'react';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './Chat.module.css';

export interface ChatInputProps {
  onSend: (message: string, files?: File[]) => Promise<void> | void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Type a message...',
}: ChatInputProps) {
  const { t } = useLocaleText();
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const target = textareaRef.current;
    if (!target) return;
    target.style.height = 'auto';
    const nextHeight = Math.min(target.scrollHeight, 140);
    target.style.height = `${nextHeight}px`;
  }, [value]);

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
  }, []);

  const handleFileSelect = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []);
    if (nextFiles.length === 0) {
      return;
    }
    setAttachments((prev) => {
      const merged = [...prev];
      for (const file of nextFiles) {
        const exists = merged.some(
          (item) =>
            item.name === file.name &&
            item.size === file.size &&
            item.lastModified === file.lastModified
        );
        if (!exists) {
          merged.push(file);
        }
      }
      return merged.slice(0, 10);
    });
    event.target.value = '';
  }, []);

  const removeAttachment = useCallback((targetIndex: number) => {
    setAttachments((prev) => prev.filter((_, index) => index !== targetIndex));
  }, []);

  const handleOpenPicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const canSend = !disabled && !submitting && (value.trim().length > 0 || attachments.length > 0);

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const text = value.trim();
    let succeeded = false;
    setSubmitting(true);
    try {
      await onSend(text, attachments);
      succeeded = true;
    } finally {
      setSubmitting(false);
      if (succeeded) {
        setValue('');
        setAttachments([]);
      }
    }
  }, [attachments, canSend, onSend, value]);

  const handleSendClick = useCallback(() => {
    void handleSend();
  }, [handleSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className={styles.inputContainer}>
      <input
        ref={fileInputRef}
        type="file"
        className={styles.hiddenFileInput}
        onChange={handleFileSelect}
        multiple
      />
      {attachments.length > 0 && (
        <div className={styles.attachmentTray}>
          {attachments.map((file, index) => (
            <div key={`${file.name}_${file.size}_${file.lastModified}`} className={styles.attachmentChip}>
              <span className={styles.attachmentName}>{file.name}</span>
              <button
                type="button"
                className={styles.attachmentRemove}
                onClick={() => removeAttachment(index)}
                disabled={disabled || submitting}
                aria-label={t('Remove attachment', '移除附件')}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className={styles.input}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || submitting}
        rows={1}
        maxLength={4000}
        aria-label={t('Message input', '消息输入框')}
      />
      <div className={styles.inputActions}>
        <button
          type="button"
          className={styles.attachButton}
          onClick={handleOpenPicker}
          disabled={disabled || submitting}
        >
          {t('Attach', '附件')}
        </button>
        <button
          className={styles.sendButton}
          onClick={handleSendClick}
          disabled={!canSend}
        >
          {submitting ? t('Sending...', '发送中...') : t('Send', '发送')}
        </button>
      </div>
      <button
        type="button"
        className={styles.mobileAttachButton}
        onClick={handleOpenPicker}
        disabled={disabled || submitting}
      >
        {t('Attach File', '上传文件')}
      </button>
      <div className={styles.inputHint}>
        {t(
          'Enter to send · Shift+Enter for newline · Max 10 attachments',
          'Enter 发送 · Shift+Enter 换行 · 最多 10 个附件'
        )}
      </div>
    </div>
  );
}
