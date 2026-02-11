/**
 * RunCard - displays a single run summary
 */

import type { RunMeta } from '../../types';
import styles from './Runs.module.css';

export interface RunCardProps {
  run: RunMeta;
  onOpenTrace?: (runId: string) => void;
  onCancel?: (runId: string) => void;
  isCancelling?: boolean;
}

function formatDuration(durationMs: number | null): string {
  if (!durationMs) return 'Running...';
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function RunCard({ run, onOpenTrace, onCancel, isCancelling = false }: RunCardProps) {
  const startTime = new Date(run.started_at).toLocaleString();
  const duration = formatDuration(run.duration_ms);
  const canCancel = run.status === 'pending';

  return (
    <article className={styles.runCard}>
      <div className={styles.runHeader}>
        <span className={styles.runId} title={run.run_id}>
          {run.run_id}
        </span>
        <span className={`${styles.status} ${styles[run.status]}`}>
          {run.status}
        </span>
      </div>
      <div className={styles.runDetails}>
        <span>Started: {startTime}</span>
        <span>Duration: {duration}</span>
      </div>
      <div className={styles.runStats}>
        <span>Events: {run.event_count}</span>
        <span>Tool calls: {run.tool_call_count}</span>
      </div>
      <div className={styles.runActions}>
        <button
          className={styles.openButton}
          onClick={() => onOpenTrace?.(run.run_id)}
        >
          View Trace
        </button>
        <button
          className={styles.cancelButton}
          onClick={() => onCancel?.(run.run_id)}
          disabled={!canCancel || isCancelling}
        >
          {isCancelling ? 'Cancelling...' : 'Cancel Pending'}
        </button>
      </div>
    </article>
  );
}
