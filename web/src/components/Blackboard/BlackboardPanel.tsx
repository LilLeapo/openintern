/**
 * BlackboardPanel - main panel showing group blackboard state
 */

import { useBlackboard } from '../../hooks/useBlackboard';
import { DecisionCard } from './DecisionCard';
import { EvidenceList } from './EvidenceList';
import { TodoList } from './TodoList';
import styles from './BlackboardPanel.module.css';

interface BlackboardPanelProps {
  groupId: string | null;
}

export function BlackboardPanel({ groupId }: BlackboardPanelProps) {
  const { decisions, evidence, todos, loading, error, refresh } =
    useBlackboard(groupId);

  if (!groupId) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>Select a group to view its blackboard.</p>
      </div>
    );
  }

  if (loading) {
    return <div className={styles.loading}>Loading blackboard...</div>;
  }

  if (error) {
    return <div className={styles.error}>{error.message}</div>;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2>Blackboard</h2>
        <button className={styles.refreshBtn} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Consensus</h3>
        {decisions.length === 0 ? (
          <p className={styles.empty}>No decisions yet.</p>
        ) : (
          decisions.map((d) => <DecisionCard key={d.id} memory={d} />)
        )}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>TODOs</h3>
        <TodoList todos={todos} />
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Evidence</h3>
        <EvidenceList evidence={evidence} />
      </div>
    </div>
  );
}
