/**
 * RunCard - displays a single run summary
 */

import type { RunMeta } from '../../types';
import styles from './Runs.module.css';

export interface RunCardProps {
  run: RunMeta;
  onClick?: () => void;
}

export function RunCard({ run, onClick }: RunCardProps) {
  const startTime = new Date(run.started_at).toLocaleString();
  const duration = run.duration_ms
    ? `${(run.duration_ms / 1000).toFixed(1)}s`
    : 'Running...';

  return (
    <div className={styles.runCard} onClick={onClick}>
      <div className={styles.runHeader}>
        <span className={styles.runId}>{run.run_id}</span>
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
    </div>
  );
}
