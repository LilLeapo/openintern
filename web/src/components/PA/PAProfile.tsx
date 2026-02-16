/**
 * PAProfile - displays the PA's identity and current status in the sidebar
 */

import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './PA.module.css';

export interface PAProfileProps {
  isRunning?: boolean;
  isWaiting?: boolean;
}

export function PAProfile({ isRunning = false, isWaiting = false }: PAProfileProps) {
  const { t } = useLocaleText();

  const status = isWaiting
    ? t('Coordinating team...', '协调团队中...')
    : isRunning
      ? t('Thinking...', '思考中...')
      : t('Ready', '就绪');

  const statusClass = isWaiting
    ? styles.statusWaiting
    : isRunning
      ? styles.statusBusy
      : styles.statusReady;

  return (
    <div className={styles.profile}>
      <div className={styles.avatar} aria-hidden="true">PA</div>
      <div className={styles.info}>
        <span className={styles.name}>{t('Your Assistant', '你的助理')}</span>
        <span className={`${styles.status} ${statusClass}`}>{status}</span>
      </div>
      <p className={styles.bio}>
        {t(
          'I can help you with various tasks. When needed, I will bring in expert teams automatically.',
          '我可以帮你处理各种任务，必要时会自动召集专家团队协助。',
        )}
      </p>
    </div>
  );
}
