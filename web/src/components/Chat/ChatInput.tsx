/**
 * ChatInput - input component for sending messages with file attachments
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, ChangeEvent } from 'react';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './Chat.module.css';

const MAX_ATTACHMENTS = 5;
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB
const ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
  'text/html',
].join(',');

export interface ChatInputProps {
  onSend: (message: string, files?: File[]) => void;
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
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
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

  const handleSend = useCallback(() => {
    if (value.trim() && !disabled) {
      onSend(value.trim(), files.length > 0 ? files : undefined);
      setValue('');
      setFiles([]);
      setFileError(null);
    }
  }, [value, disabled, onSend, files]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;

    setFileError(null);
    const newFiles: File[] = [];

    for (let i = 0; i < selected.length; i++) {
      const file = selected[i];
      if (!file) continue;

      if (file.size > MAX_FILE_SIZE) {
        setFileError(t(`${file.name} is too large (max 8MB)`, `${file.name} 太大了（最大 8MB）`));
        continue;
      }
      newFiles.push(file);
    }

    setFiles(prev => {
      const combined = [...prev, ...newFiles];
      if (combined.length > MAX_ATTACHMENTS) {
        setFileError(t(`Max ${MAX_ATTACHMENTS} files allowed`, `最多允许 ${MAX_ATTACHMENTS} 个文件`));
        return combined.slice(0, MAX_ATTACHMENTS);
      }
      return combined;
    });

    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [t]);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setFileError(null);
  }, []);

  return (
    <div className={styles.inputContainer}>
      {files.length > 0 && (
        <div className={styles.attachmentList} role="list" aria-label={t('Attached files', '已附加文件')}>
          {files.map((file, idx) => (
            <div key={`${file.name}-${idx}`} className={styles.attachmentChip} role="listitem">
              <span className={styles.attachmentName}>
                {file.type.startsWith('image/') ? '\u{1F5BC}' : '\u{1F4C4}'}{' '}
                {file.name.length > 20 ? file.name.slice(0, 17) + '...' : file.name}
              </span>
              <button
                className={styles.attachmentRemove}
                onClick={() => removeFile(idx)}
                aria-label={t(`Remove ${file.name}`, `移除 ${file.name}`)}
                type="button"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
      {fileError && (
        <div className={styles.fileError} role="alert">{fileError}</div>
      )}
      <div className={styles.inputRow}>
        <button
          className={styles.attachButton}
          onClick={handleFileSelect}
          disabled={disabled || files.length >= MAX_ATTACHMENTS}
          aria-label={t('Attach file', '附加文件')}
          type="button"
          title={t('Attach file', '附加文件')}
        >
          +
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          onChange={handleFileChange}
          style={{ display: 'none' }}
          aria-hidden="true"
        />
        <textarea
          ref={textareaRef}
          className={styles.input}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          maxLength={4000}
          aria-label={t('Message input', '消息输入框')}
        />
        <button
          className={styles.sendButton}
          onClick={handleSend}
          disabled={disabled || !value.trim()}
        >
          {t('Send', '发送')}
        </button>
      </div>
      <div className={styles.inputHint}>
        {t('Enter to send · Shift+Enter for newline', 'Enter 发送 · Shift+Enter 换行')}
      </div>
    </div>
  );
}
