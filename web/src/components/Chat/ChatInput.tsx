/**
 * ChatInput - input component for sending messages
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, ChangeEvent } from 'react';
import styles from './Chat.module.css';

export interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Type a message...',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      onSend(value.trim());
      setValue('');
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className={styles.inputContainer}>
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
        aria-label="Message input"
      />
      <button
        className={styles.sendButton}
        onClick={handleSend}
        disabled={disabled || !value.trim()}
      >
        Send
      </button>
      <div className={styles.inputHint}>
        Enter to send · Shift+Enter for newline
      </div>
    </div>
  );
}
