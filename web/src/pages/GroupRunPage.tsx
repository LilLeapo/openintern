/**
 * GroupRunPage - displays a group run's discussion thread with user intervention
 */

import { useNavigate, useParams } from 'react-router-dom';
import { useGroupRun } from '../hooks/useGroupRun';
import { GroupRunHeader, GroupDiscussionThread, UserInterventionInput } from '../components/GroupRun';
import { AppShell } from '../components/Layout/AppShell';
import { useLocaleText } from '../i18n/useLocaleText';
import styles from './GroupRunPage.module.css';

export function GroupRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { t } = useLocaleText();
  const { run, parentRun, messages, loading, error, isLive, injectMessage } = useGroupRun(runId ?? null);

  const canIntervene = isLive;

  return (
    <AppShell
      title={t('Group Discussion', '团队讨论')}
      subtitle={
        run
          ? t(
              `Run ${run.run_id} · ${run.status}`,
              `任务 ${run.run_id} · ${run.status}`,
            )
          : t('Loading...', '加载中...')
      }
      actions={
        parentRun ? (
          <button
            className={styles.pageAction}
            onClick={() => navigate('/')}
          >
            {t('Back to PA Chat', '返回 PA 对话')}
          </button>
        ) : undefined
      }
    >
      <div className={styles.layout}>
        {error && (
          <div className={styles.errorBanner}>
            {t('Error:', '错误：')} {error.message}
          </div>
        )}
        {run && (
          <GroupRunHeader
            run={run}
            parentRun={parentRun}
            onBack={() => navigate('/')}
          />
        )}
        <GroupDiscussionThread messages={messages} loading={loading} />
        <UserInterventionInput
          onSend={injectMessage}
          disabled={!canIntervene}
        />
      </div>
    </AppShell>
  );
}
