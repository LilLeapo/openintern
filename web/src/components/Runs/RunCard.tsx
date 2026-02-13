/**
 * RunCard - displays a single run summary
 */

import type { RunMeta } from '../../types';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './Runs.module.css';

export interface RunCardProps {
  run: RunMeta;
  onOpenTrace?: (runId: string) => void;
  onCancel?: (runId: string) => void;
  isCancelling?: boolean;
}

function formatDuration(durationMs: number | null, t: (en: string, zh: string) => string): string {
  if (!durationMs) return t('Running...', '运行中...');
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function RunCard({ run, onOpenTrace, onCancel, isCancelling = false }: RunCardProps) {
  const { t, isZh } = useLocaleText();
  const startTime = new Date(run.started_at).toLocaleString();
  const duration = formatDuration(run.duration_ms, t);
  const canCancel = run.status === 'pending' || run.status === 'running' || run.status === 'waiting';
  const statusLabel = (() => {
    if (!isZh) {
      return run.status;
    }
    switch (run.status) {
      case 'pending':
        return '等待中';
      case 'running':
        return '运行中';
      case 'completed':
        return '已完成';
      case 'failed':
        return '失败';
      case 'waiting':
        return '等待中';
      case 'cancelled':
        return '已取消';
      default:
        return run.status;
    }
  })();

  return (
    <article className={styles.runCard}>
      <div className={styles.runHeader}>
        <span className={styles.runId} title={run.run_id}>
          {run.run_id}
        </span>
        <span className={`${styles.status} ${styles[run.status]}`}>
          {statusLabel}
        </span>
      </div>
      <div className={styles.runDetails}>
        <span>{t('Started:', '开始时间：')} {startTime}</span>
        <span>{t('Duration:', '耗时：')} {duration}</span>
      </div>
      <div className={styles.runStats}>
        <span>{t('Events:', '事件数：')} {run.event_count}</span>
        <span>{t('Tool calls:', '工具调用：')} {run.tool_call_count}</span>
      </div>
      <div className={styles.runActions}>
        <button
          className={styles.openButton}
          onClick={() => onOpenTrace?.(run.run_id)}
        >
          {t('View Trace', '查看追踪')}
        </button>
        <button
          className={styles.cancelButton}
          onClick={() => onCancel?.(run.run_id)}
          disabled={!canCancel || isCancelling}
        >
          {isCancelling ? t('Cancelling...', '取消中...') : t('Cancel Run', '取消任务')}
        </button>
      </div>
    </article>
  );
}
