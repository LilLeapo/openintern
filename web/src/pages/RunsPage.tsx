/**
 * RunsPage - runs list page
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RunsList } from '../components/Runs';
import { useRuns } from '../hooks/useRuns';
import styles from './Pages.module.css';

const DEFAULT_SESSION = 's_default';

export function RunsPage() {
  const [sessionKey] = useState(DEFAULT_SESSION);
  const navigate = useNavigate();
  const { runs, loading, total, page, loadRuns, refresh } = useRuns(sessionKey);

  const handleRunClick = (runId: string) => {
    navigate(`/trace/${runId}`);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backButton} onClick={() => navigate('/')}>
          Back to Chat
        </button>
        <h1>Runs History</h1>
        <button className={styles.refreshButton} onClick={() => void refresh()}>
          Refresh
        </button>
      </header>
      <main className={styles.main}>
        <RunsList
          runs={runs}
          loading={loading}
          total={total}
          page={page}
          onPageChange={(p) => void loadRuns(p)}
          onRunClick={handleRunClick}
        />
      </main>
    </div>
  );
}
