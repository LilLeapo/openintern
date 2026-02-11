/**
 * BlackboardPanel - main panel showing group blackboard state
 */

import { useEffect } from 'react';
import { useBlackboard } from '../../hooks/useBlackboard';
import { useLocaleText } from '../../i18n/useLocaleText';
import { DecisionCard } from './DecisionCard';
import { EvidenceList } from './EvidenceList';
import { TodoList } from './TodoList';
import styles from './BlackboardPanel.module.css';

interface BlackboardPanelProps {
  groupId: string | null;
  refreshNonce?: number;
}

export function BlackboardPanel({ groupId, refreshNonce = 0 }: BlackboardPanelProps) {
  const { t } = useLocaleText();
  const { decisions, evidence, todos, loading, error, refresh } =
    useBlackboard(groupId);

  useEffect(() => {
    if (!groupId) return;
    void refresh();
  }, [groupId, refresh, refreshNonce]);

  if (!groupId) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>{t('Select a team to view shared notes.', '请选择团队以查看共享笔记。')}</p>
      </div>
    );
  }

  if (loading) {
    return <div className={styles.loading}>{t('Loading team notes...', '正在加载团队笔记...')}</div>;
  }

  if (error) {
    return <div className={styles.error}>{error.message}</div>;
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2>{t('Team Notes', '团队笔记')}</h2>
        <button className={styles.refreshBtn} onClick={() => void refresh()}>
          {t('Refresh', '刷新')}
        </button>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('Decisions', '决策')}</h3>
        {decisions.length === 0 ? (
          <p className={styles.empty}>{t('No decisions yet.', '暂时没有决策。')}</p>
        ) : (
          decisions.map((d) => <DecisionCard key={d.id} memory={d} />)
        )}
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('Action Items', '行动项')}</h3>
        <TodoList todos={todos} />
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('Evidence', '证据')}</h3>
        <EvidenceList evidence={evidence} />
      </div>
    </div>
  );
}
