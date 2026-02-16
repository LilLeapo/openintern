/**
 * ChatMessage - displays a single chat message with markdown rendering and attachments
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
  escalationRunId?: string | null;
  onViewGroupDiscussion?: () => void;
}

const remarkPlugins = [remarkGfm];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatMessage({ message, escalationRunId, onViewGroupDiscussion }: ChatMessageProps) {
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

  const attachments = message.attachments;

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
        {attachments && attachments.length > 0 && (
          <div className={styles.messageAttachments} role="list" aria-label={t('Attachments', '附件')}>
            {attachments.map((att) => (
              <div key={att.upload_id} className={styles.messageAttachmentChip} role="listitem">
                <span className={styles.attachmentIcon}>
                  {att.mime_type.startsWith('image/') ? '\u{1F5BC}' : '\u{1F4C4}'}
                </span>
                <span className={styles.attachmentInfo}>
                  {att.original_name}
                  <span className={styles.attachmentSize}>{formatFileSize(att.size)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className={styles.messageText}>
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            components={markdownComponents}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        {!isUser && escalationRunId && (
          <div className={styles.escalationNote}>
            <span>{t(
              'Expert team was consulted for this response.',
              '此回复经过专家团队协助完成。',
            )}</span>
            {onViewGroupDiscussion && (
              <button
                className={styles.escalationLink}
                onClick={onViewGroupDiscussion}
              >
                {t('View team discussion', '查看团队讨论')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
