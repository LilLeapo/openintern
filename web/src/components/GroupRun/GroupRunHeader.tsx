/**
 * GroupRunHeader - displays group run status and navigation back to parent
 */

import type { RunMeta } from '../../types';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './GroupRun.module.css';

export interface GroupRunHeaderProps {
  run: RunMeta;
  parentRun: RunMeta | null;
  onBack?: () => void;
}

export function GroupRunHeader({ run, parentRun, onBack }: GroupRunHeaderProps) {
  const { t } = useLocaleText();

  const statusLabel = (() => {
    switch (run.status) {
      case 'running':
        return t('Running', '运行中');
      case 'waiting':
        return t('Waiting', '等待中');
      case 'completed':
        return t('Completed', '已完成');
      case 'failed':
        return t('Failed', '失败');
      case 'pending':
        return t('Pending', '等待中');
      case 'cancelled':
        return t('Cancelled', '已取消');
      default:
        return run.status;
    }
  })();

  return (
    <div className={styles.header}>
      <div className={styles.headerInfo}>
        <h2 className={styles.headerTitle}>
          {t('Group Discussion', '团队讨论')}
        </h2>
        <div className={styles.headerMeta}>
          <span className={`${styles.statusBadge} ${styles[run.status]}`}>
            {statusLabel}
          </span>
          <span>{run.run_id}</span>
          {parentRun && (
            <span>
              {t('Parent:', '父任务：')} {parentRun.run_id}
            </span>
          )}
        </div>
      </div>
      <div className={styles.headerActions}>
        {onBack && (
          <button className={styles.backButton} onClick={onBack}>
            {t('Back to PA Chat', '返回 PA 对话')}
          </button>
        )}
      </div>
    </div>
  );
}
