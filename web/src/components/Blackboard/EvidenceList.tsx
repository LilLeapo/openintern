/**
 * EvidenceList - displays evidence reference memories
 */

import type { BlackboardMemory } from '../../types';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './BlackboardPanel.module.css';

interface EvidenceListProps {
  evidence: BlackboardMemory[];
}

export function EvidenceList({ evidence }: EvidenceListProps) {
  const { t } = useLocaleText();
  if (evidence.length === 0) {
    return <p className={styles.empty}>{t('No evidence collected yet.', '暂时没有收集到证据。')}</p>;
  }

  return (
    <div className={styles.list}>
      {evidence.map((mem) => {
        const summary = mem.text.replace('EVIDENCE: ', '');
        const refs = mem.metadata?.refs as
          | Array<{ type: string; id: string }>
          | undefined;

        return (
          <div key={mem.id} className={styles.evidenceItem}>
            <div className={styles.evidenceHeader}>
              <span className={styles.badgeEvidence}>{t('Evidence', '证据')}</span>
              <span className={styles.timestamp}>
                {new Date(mem.created_at).toLocaleString()}
              </span>
            </div>
            <p className={styles.cardText}>{summary}</p>
            {refs && refs.length > 0 && (
              <div className={styles.refs}>
                {refs.map((ref, i) => (
                  <span key={i} className={styles.refTag}>
                    {ref.type}:{ref.id}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
