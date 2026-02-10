/**
 * BlackboardPage - page for viewing group blackboard
 */

import { useNavigate, useParams } from 'react-router-dom';
import { BlackboardPanel } from '../components/Blackboard';
import styles from './Pages.module.css';

export function BlackboardPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Group Blackboard</h1>
        <button
          className={styles.backButton}
          onClick={() => navigate('/')}
        >
          Back to Chat
        </button>
      </header>
      <main className={styles.main}>
        <BlackboardPanel groupId={groupId ?? null} />
      </main>
    </div>
  );
}
