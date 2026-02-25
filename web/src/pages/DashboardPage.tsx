import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/Layout/AppShell';
import { apiClient } from '../api/client';
import { useAppPreferences } from '../context/AppPreferencesContext';
import { useLocaleText } from '../i18n/useLocaleText';
import type { Event } from '../types/events';
import type { RunMeta } from '../types';
import { readRunScopeRegistry } from '../utils/runScopeRegistry';
import styles from './DashboardPage.module.css';

interface TenantBar {
  id: string;
  label: string;
  count: number;
}

interface AlertItem {
  id: string;
  title: string;
  detail: string;
  ts: string;
  level: 'error' | 'warn';
}

function startOfTodayTs(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function DashboardPage() {
  const { t } = useLocaleText();
  const { sessionHistory, tenantScope } = useAppPreferences();
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [eventsByRun, setEventsByRun] = useState<Record<string, Event[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sessions = sessionHistory.slice(0, 12);
      const runResults = await Promise.all(
        sessions.map(async (sessionKey) => {
          try {
            const data = await apiClient.listRuns(sessionKey, 1, 100);
            return data.runs;
          } catch {
            return [];
          }
        }),
      );

      const mergedRuns = runResults
        .flat()
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

      const dedupedRuns: RunMeta[] = [];
      const seen = new Set<string>();
      for (const run of mergedRuns) {
        if (seen.has(run.run_id)) continue;
        seen.add(run.run_id);
        dedupedRuns.push(run);
      }
      setRuns(dedupedRuns);

      const eventRuns = dedupedRuns.slice(0, 20);
      const eventPairs = await Promise.all(
        eventRuns.map(async (run) => {
          try {
            const events = await apiClient.getEvents(run.run_id, undefined, {
              includeTokens: false,
              pageLimit: 300,
            });
            return [run.run_id, events] as const;
          } catch {
            return [run.run_id, []] as const;
          }
        }),
      );
      setEventsByRun(Object.fromEntries(eventPairs));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to load dashboard', '加载大盘失败'));
    } finally {
      setLoading(false);
    }
  }, [sessionHistory, t]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const statusStats = useMemo(() => {
    return {
      pending: runs.filter(run => run.status === 'pending').length,
      running: runs.filter(run => run.status === 'running' || run.status === 'waiting').length,
      suspended: runs.filter(run => run.status === 'suspended').length,
    };
  }, [runs]);

  const tokenStats = useMemo(() => {
    const todayStart = startOfTodayTs();
    let tokenTotal = 0;
    let failedCalls = 0;
    let totalCalls = 0;

    Object.values(eventsByRun).forEach((events) => {
      events.forEach((event) => {
        const ts = new Date(event.ts).getTime();
        if (event.type === 'llm.called') {
          const payload = event.payload as { totalTokens?: number };
          if (ts >= todayStart) {
            tokenTotal += payload.totalTokens ?? 0;
          }
          totalCalls += 1;
          return;
        }
        if (event.type === 'tool.result') {
          const payload = event.payload as { isError?: boolean };
          totalCalls += 1;
          if (payload.isError) {
            failedCalls += 1;
          }
          return;
        }
        if (event.type === 'run.failed') {
          failedCalls += 1;
        }
      });
    });

    const failureRate = totalCalls > 0 ? (failedCalls / totalCalls) * 100 : 0;
    return { tokenTotal, failureRate };
  }, [eventsByRun]);

  const tenantBars = useMemo<TenantBar[]>(() => {
    const registry = readRunScopeRegistry();
    const grouped = new Map<string, number>();

    runs.forEach((run) => {
      const scope = registry[run.run_id] ?? {
        orgId: tenantScope.orgId,
        userId: tenantScope.userId,
        projectId: tenantScope.projectId,
      };
      const key = `${scope.orgId}/${scope.projectId ?? 'default'}`;
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    });

    if (grouped.size === 0) {
      grouped.set(`${tenantScope.orgId}/${tenantScope.projectId ?? 'default'}`, 0);
    }

    return [...grouped.entries()]
      .map(([key, count], idx) => ({
        id: `${key}_${idx}`,
        label: key,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [runs, tenantScope.orgId, tenantScope.projectId, tenantScope.userId]);

  const alerts = useMemo<AlertItem[]>(() => {
    const items: AlertItem[] = [];
    runs
      .filter(run => run.status === 'failed')
      .slice(0, 12)
      .forEach((run) => {
        items.push({
          id: `run_fail_${run.run_id}`,
          title: t('Run Failed', '运行失败'),
          detail: run.run_id,
          ts: run.started_at,
          level: 'error',
        });
      });

    Object.entries(eventsByRun).forEach(([runId, events]) => {
      events.forEach((event) => {
        if (event.type === 'tool.blocked') {
          const payload = event.payload as { toolName?: string; reason?: string };
          items.push({
            id: `${runId}_${event.span_id}_blocked`,
            title: t('Tool Blocked', '工具被拦截'),
            detail: `${payload.toolName ?? 'unknown'} - ${payload.reason ?? ''}`.trim(),
            ts: event.ts,
            level: 'warn',
          });
        }
        if (event.type === 'run.failed') {
          const payload = event.payload as { error?: { message?: string } };
          items.push({
            id: `${runId}_${event.span_id}_rf`,
            title: t('Runtime Error', '运行时错误'),
            detail: payload.error?.message ?? runId,
            ts: event.ts,
            level: 'error',
          });
        }
      });
    });

    return items
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, 10);
  }, [eventsByRun, runs, t]);

  const maxTenantCount = Math.max(...tenantBars.map(item => item.count), 1);

  return (
    <AppShell
      title={t('Runtime Dashboard', 'Runtime 大盘')}
      subtitle={t(
        'Health, consumption, and multi-tenant workload overview',
        '健康度、消耗与多租户任务概览',
      )}
      actions={(
        <button className={styles.refreshButton} onClick={() => void loadDashboard()}>
          {t('Refresh', '刷新')}
        </button>
      )}
    >
      <div className={styles.layout}>
        <section className={styles.coreGrid}>
          <article className={styles.metricCard}>
            <span>{t('Pending Runs', 'Pending 运行')}</span>
            <strong>{statusStats.pending}</strong>
          </article>
          <article className={styles.metricCard}>
            <span>{t('Running Runs', 'Running 运行')}</span>
            <strong>{statusStats.running}</strong>
          </article>
          <article className={styles.metricCard}>
            <span>{t('Suspended Runs', 'Suspended 运行')}</span>
            <strong>{statusStats.suspended}</strong>
          </article>
          <article className={styles.metricCard}>
            <span>{t('Today Tokens', '今日 Token')}</span>
            <strong>{tokenStats.tokenTotal.toLocaleString()}</strong>
          </article>
          <article className={styles.metricCard}>
            <span>{t('API Failure Rate', 'API 失败率')}</span>
            <strong>{tokenStats.failureRate.toFixed(2)}%</strong>
          </article>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h3>{t('Tenant Activity (org/project)', '租户活跃度（org/project）')}</h3>
          </header>
          {tenantBars.map((item) => (
            <div key={item.id} className={styles.barRow}>
              <div className={styles.barLabel}>{item.label}</div>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{ width: `${(item.count / maxTenantCount) * 100}%` }}
                />
              </div>
              <div className={styles.barValue}>{item.count}</div>
            </div>
          ))}
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h3>{t('Latest Alerts / Exceptions', '最新告警 / 异常')}</h3>
          </header>
          {loading && <p className={styles.placeholder}>{t('Loading...', '加载中...')}</p>}
          {error && <p className={styles.error}>{error}</p>}
          {!loading && !error && alerts.length === 0 && (
            <p className={styles.placeholder}>{t('No alerts in current sample', '当前样本中暂无告警')}</p>
          )}
          {!loading && !error && alerts.map((alert) => (
            <article
              key={alert.id}
              className={`${styles.alertCard} ${alert.level === 'error' ? styles.errorCard : styles.warnCard}`}
            >
              <div className={styles.alertTitle}>{alert.title}</div>
              <div className={styles.alertDetail}>{alert.detail}</div>
              <time className={styles.alertTime}>{new Date(alert.ts).toLocaleString()}</time>
            </article>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
