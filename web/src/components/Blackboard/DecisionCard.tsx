/**
 * DecisionCard - displays a single decision memory
 */

import type { BlackboardMemory } from '../../types';
import styles from './BlackboardPanel.module.css';

interface DecisionCardProps {
  memory: BlackboardMemory;
}

export function DecisionCard({ memory }: DecisionCardProps) {
  const lines = memory.text.split('\n');
  const decisionLine = lines.find((l) => l.startsWith('DECISION:'));
  const rationaleLine = lines.find((l) => l.startsWith('Rationale:'));

  const decision = decisionLine?.replace('DECISION: ', '') ?? memory.text;
  const rationale = rationaleLine?.replace('Rationale: ', '') ?? '';

  const refs = memory.metadata?.evidence_refs as
    | Array<{ type: string; id: string }>
    | undefined;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.badge}>DECISION</span>
        <span className={styles.timestamp}>
          {new Date(memory.created_at).toLocaleString()}
        </span>
      </div>
      <p className={styles.cardText}>{decision}</p>
      {rationale && (
        <p className={styles.rationale}>{rationale}</p>
      )}
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
}
