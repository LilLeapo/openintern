/**
 * RunsList - displays a list of runs with pagination
 */

import { RunCard } from './RunCard';
import type { RunMeta } from '../../types';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './Runs.module.css';

export interface RunsListProps {
  runs: RunMeta[];
  loading?: boolean;
  error?: Error | null;
  total: number;
  page: number;
  limit?: number;
  onPageChange?: (page: number) => void;
  onRunClick?: (runId: string) => void;
  onCancelRun?: (runId: string) => void;
  cancellingRunId?: string | null;
}

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange?: (page: number) => void;
}

function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  const { t } = useLocaleText();
  return (
    <div className={styles.pagination}>
      <button
        className={styles.pageButton}
        disabled={page <= 1}
        onClick={() => onPageChange?.(page - 1)}
      >
        {t('Previous', '上一页')}
      </button>
      <span className={styles.pageInfo}>
        {t(`Page ${page} of ${totalPages}`, `第 ${page} / ${totalPages} 页`)}
      </span>
      <button
        className={styles.pageButton}
        disabled={page >= totalPages}
        onClick={() => onPageChange?.(page + 1)}
      >
        {t('Next', '下一页')}
      </button>
    </div>
  );
}

export function RunsList({
  runs,
  loading = false,
  error = null,
  total,
  page,
  limit = 20,
  onPageChange,
  onRunClick,
  onCancelRun,
  cancellingRunId = null,
}: RunsListProps) {
  const { t } = useLocaleText();
  const totalPages = Math.ceil(total / limit);

  return (
    <div className={styles.runsList}>
      {loading ? (
        <div className={styles.loading}>{t('Loading runs...', '正在加载任务...')}</div>
      ) : error ? (
        <div className={styles.error}>{error.message}</div>
      ) : runs.length === 0 ? (
        <div className={styles.empty}>{t('No runs found', '未找到任务')}</div>
      ) : (
        <>
          <div className={styles.runsGrid}>
            {runs.map((run) => (
              <RunCard
                key={run.run_id}
                run={run}
                onOpenTrace={onRunClick}
                onCancel={onCancelRun}
                isCancelling={cancellingRunId === run.run_id}
              />
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={onPageChange}
            />
          )}
        </>
      )}
    </div>
  );
}
