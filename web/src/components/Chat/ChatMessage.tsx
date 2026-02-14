/**
 * ChatMessage - displays a single chat message with markdown rendering
 */

import { useCallback, useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ChatMessage as ChatMessageType } from '../../types/events';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './Chat.module.css';

export interface ChatMessageProps {
  message: ChatMessageType;
}

const remarkPlugins = [remarkGfm];

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

  const markdownComponents = useMemo(
    () => ({
      code(props: React.ComponentProps<'code'>) {
        const { className, children, ...rest } = props;
        const match = /language-(\w+)/.exec(className ?? '');
        if (match) {
          return (
            <SyntaxHighlighter
              style={oneDark}
              language={match[1]}
              PreTag="div"
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          );
        }
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        );
      },
    }),
    [],
  );

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
        <div className={styles.messageText}>
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            components={markdownComponents}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
