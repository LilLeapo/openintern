/**
 * TodoList - displays TODO action items from decisions
 */

import type { BlackboardMemory } from '../../types';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './BlackboardPanel.module.css';

interface TodoListProps {
  todos: BlackboardMemory[];
}

export function TodoList({ todos }: TodoListProps) {
  const { t } = useLocaleText();
  if (todos.length === 0) {
    return <p className={styles.empty}>{t('No action items yet.', '暂时没有行动项。')}</p>;
  }

  return (
    <div className={styles.list}>
      {todos.map((mem) => {
        const action = mem.text.replace('TODO: ', '');
        const source = mem.metadata?.source_decision as string | undefined;

        return (
          <div key={mem.id} className={styles.todoItem}>
            <div className={styles.todoCheck} />
            <div className={styles.todoContent}>
              <p className={styles.todoText}>{action}</p>
              {source && (
                <p className={styles.todoSource}>
                  {t('Source:', '来源：')} {source}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
