/**
 * RunsList - displays a list of runs with pagination
 */

import { RunCard } from './RunCard';
import type { RunMeta } from '../../types';
import styles from './Runs.module.css';

export interface RunsListProps {
  runs: RunMeta[];
  loading?: boolean;
  total: number;
  page: number;
  limit?: number;
  onPageChange?: (page: number) => void;
  onRunClick?: (runId: string) => void;
}

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange?: (page: number) => void;
}

function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  return (
    <div className={styles.pagination}>
      <button
        className={styles.pageButton}
        disabled={page <= 1}
        onClick={() => onPageChange?.(page - 1)}
      >
        Previous
      </button>
      <span className={styles.pageInfo}>
        Page {page} of {totalPages}
      </span>
      <button
        className={styles.pageButton}
        disabled={page >= totalPages}
        onClick={() => onPageChange?.(page + 1)}
      >
        Next
      </button>
    </div>
  );
}

export function RunsList({
  runs,
  loading = false,
  total,
  page,
  limit = 20,
  onPageChange,
  onRunClick,
}: RunsListProps) {
  const totalPages = Math.ceil(total / limit);

  return (
    <div className={styles.runsList}>
      {loading ? (
        <div className={styles.loading}>Loading runs...</div>
      ) : runs.length === 0 ? (
        <div className={styles.empty}>No runs found</div>
      ) : (
        <>
          <div className={styles.runsGrid}>
            {runs.map((run) => (
              <RunCard
                key={run.run_id}
                run={run}
                onClick={() => onRunClick?.(run.run_id)}
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
