/**
 * ToolCallCard - displays a tool call and its result
 */

import styles from './Trace.module.css';

export interface ToolCallCardProps {
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  error?: { code: string; message: string };
  duration?: number;
}

export function ToolCallCard({
  toolName,
  args,
  result,
  isError = false,
  error,
  duration,
}: ToolCallCardProps) {
  return (
    <div className={`${styles.toolCard} ${isError ? styles.error : ''}`}>
      <div className={styles.toolHeader}>
        <span className={styles.toolName}>{toolName}</span>
        {duration !== undefined && (
          <span className={styles.duration}>{duration}ms</span>
        )}
      </div>
      <div className={styles.toolSection}>
        <div className={styles.sectionLabel}>Arguments</div>
        <pre className={styles.codeBlock}>
          {JSON.stringify(args, null, 2)}
        </pre>
      </div>
      {(result !== undefined || error) && (
        <div className={styles.toolSection}>
          <div className={styles.sectionLabel}>
            {isError ? 'Error' : 'Result'}
          </div>
          <pre className={`${styles.codeBlock} ${isError ? styles.errorText : ''}`}>
            {isError && error
              ? `${error.code}: ${error.message}`
              : JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
