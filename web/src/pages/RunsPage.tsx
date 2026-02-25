import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RunsList } from '../components/Runs';
import { useRuns } from '../hooks/useRuns';
import { apiClient } from '../api/client';
import { AppShell } from '../components/Layout/AppShell';
import { useAppPreferences } from '../context/AppPreferencesContext';
import { useLocaleText } from '../i18n/useLocaleText';
import type { RunStatus } from '../types';
import { readRunScopeRegistry } from '../utils/runScopeRegistry';
import styles from './RunsPage.module.css';

const STATUS_FILTERS: Array<'all' | RunStatus> = [
  'all',
  'pending',
  'running',
  'suspended',
  'waiting',
  'completed',
  'failed',
  'cancelled',
];

export function RunsPage() {
  const { sessionKey } = useAppPreferences();
  const { t } = useLocaleText();
  const navigate = useNavigate();
  const { runs, loading, error, total, page, loadRuns, refresh } = useRuns(sessionKey);
  const [statusFilter, setStatusFilter] = useState<'all' | RunStatus>('all');
  const [tenantFilter, setTenantFilter] = useState<'all' | string>('all');
  const [groupFilter, setGroupFilter] = useState<'all' | string>('all');
  const [query, setQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [cancelingRunId, setCancelingRunId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [groupNameById, setGroupNameById] = useState<Record<string, string>>({});

  const statusLabel = (status: 'all' | RunStatus): string => {
    switch (status) {
      case 'all':
        return t('all', '全部');
      case 'pending':
        return t('pending', '等待中');
      case 'running':
        return t('running', '运行中');
      case 'suspended':
        return t('suspended', '挂起');
      case 'waiting':
        return t('waiting', '等待组完成');
      case 'completed':
        return t('completed', '已完成');
      case 'failed':
        return t('failed', '失败');
      case 'cancelled':
        return t('cancelled', '已取消');
      default:
        return status;
    }
  };

  const handleRunClick = (runId: string) => {
    navigate(`/trace/${runId}`);
  };

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refresh]);

  useEffect(() => {
    const loadGroups = async () => {
      try {
        const groups = await apiClient.listGroups();
        setGroupNameById(
          Object.fromEntries(groups.map(group => [group.id, group.name])),
        );
      } catch {
        setGroupNameById({});
      }
    };
    void loadGroups();
  }, []);

  const scopeRegistry = readRunScopeRegistry();

  const tenantOptions = useMemo(() => {
    const values = new Set<string>();
    runs.forEach((run) => {
      const scope = scopeRegistry[run.run_id];
      if (!scope) return;
      values.add(`${scope.orgId}/${scope.projectId ?? 'default'}`);
    });
    return [...values].sort();
  }, [runs, scopeRegistry]);

  const groupOptions = useMemo(() => {
    const values = new Set<string>();
    runs.forEach((run) => {
      const groupId = scopeRegistry[run.run_id]?.groupId;
      if (groupId) {
        values.add(groupId);
      }
    });
    return [...values].sort();
  }, [runs, scopeRegistry]);

  const filteredRuns = useMemo(() => {
    return runs.filter(run => {
      const matchesStatus = statusFilter === 'all' || run.status === statusFilter;
      const scope = scopeRegistry[run.run_id];
      const tenantKey = scope ? `${scope.orgId}/${scope.projectId ?? 'default'}` : 'unknown/default';
      const matchesTenant = tenantFilter === 'all' || tenantKey === tenantFilter;
      const runGroupId = scope?.groupId ?? 'none';
      const matchesGroup = groupFilter === 'all' || runGroupId === groupFilter;
      const normalizedQuery = query.trim().toLowerCase();
      const matchesQuery =
        normalizedQuery.length === 0 ||
        run.run_id.toLowerCase().includes(normalizedQuery) ||
        run.status.toLowerCase().includes(normalizedQuery);
      return matchesStatus && matchesQuery && matchesTenant && matchesGroup;
    });
  }, [runs, statusFilter, tenantFilter, groupFilter, query, scopeRegistry]);

  const effectiveTotal = statusFilter === 'all' && query.trim() === ''
    ? total
    : filteredRuns.length;

  const stats = useMemo(() => {
    const completed = runs.filter(run => run.status === 'completed').length;
    const failed = runs.filter(run => run.status === 'failed').length;
    const pending = runs.filter(run => run.status === 'pending').length;
    const suspended = runs.filter(run => run.status === 'suspended').length;
    const averageDuration = (() => {
      const durations = runs.map(run => run.duration_ms).filter((v): v is number => v !== null);
      if (durations.length === 0) return 'N/A';
      const average = durations.reduce((sum, ms) => sum + ms, 0) / durations.length;
      if (average < 1000) return `${Math.round(average)}ms`;
      return `${(average / 1000).toFixed(2)}s`;
    })();
    return { completed, failed, pending, suspended, averageDuration };
  }, [runs]);

  const handleCancelRun = async (runId: string) => {
    setCancelingRunId(runId);
    setActionError(null);
    try {
      await apiClient.cancelRun(runId);
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel run';
      setActionError(message);
    } finally {
      setCancelingRunId(null);
    }
  };

  return (
    <AppShell
      title={t('Task Center', '任务中心')}
      subtitle={t(
        `Task operations for conversation ${sessionKey}`,
        `会话 ${sessionKey} 的任务操作`,
      )}
      actions={
        <button className={styles.pageAction} onClick={() => void refresh()}>
          {t('Refresh Now', '立即刷新')}
        </button>
      }
    >
      <div className={styles.layout}>
        <section className={styles.statsGrid}>
          <article className={styles.statCard}>
            <span>{t('Total Tasks', '任务总数')}</span>
            <strong>{total}</strong>
          </article>
          <article className={styles.statCard}>
            <span>{t('Completed', '已完成')}</span>
            <strong>{stats.completed}</strong>
          </article>
          <article className={styles.statCard}>
            <span>{t('Failed', '失败')}</span>
            <strong>{stats.failed}</strong>
          </article>
          <article className={styles.statCard}>
            <span>{t('Pending', '等待中')}</span>
            <strong>{stats.pending}</strong>
          </article>
          <article className={styles.statCard}>
            <span>{t('Suspended', '挂起')}</span>
            <strong>{stats.suspended}</strong>
          </article>
          <article className={styles.statCard}>
            <span>{t('Average Duration', '平均耗时')}</span>
            <strong>{stats.averageDuration}</strong>
          </article>
        </section>
        <section className={styles.controlsCard}>
          <div className={styles.searchWrap}>
            <input
                className={styles.searchInput}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('Search by task id or status', '按任务 ID 或状态搜索')}
                aria-label={t('Search tasks', '搜索任务')}
              />
              <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
              />
              <span>{t('Auto refresh (8s)', '自动刷新（8秒）')}</span>
            </label>
          </div>
          <div className={styles.searchWrap}>
            <label className={styles.selectWrap}>
              <span>{t('Tenant', '租户')}</span>
              <select
                className={styles.select}
                value={tenantFilter}
                onChange={e => setTenantFilter(e.target.value as 'all' | string)}
              >
                <option value="all">{t('All tenants', '全部租户')}</option>
                {tenantOptions.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className={styles.selectWrap}>
              <span>{t('Group', '群组')}</span>
              <select
                className={styles.select}
                value={groupFilter}
                onChange={e => setGroupFilter(e.target.value as 'all' | string)}
              >
                <option value="all">{t('All groups', '全部群组')}</option>
                {groupOptions.map(option => (
                  <option key={option} value={option}>
                    {groupNameById[option] ? `${groupNameById[option]} (${option})` : option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.filters}>
            {STATUS_FILTERS.map(status => (
              <button
                key={status}
                className={`${styles.filterButton} ${
                  statusFilter === status ? styles.filterButtonActive : ''
                }`}
                onClick={() => setStatusFilter(status)}
              >
                {statusLabel(status)}
              </button>
            ))}
          </div>
          {actionError && <p className={styles.actionError}>{actionError}</p>}
        </section>
        <section className={styles.listSection}>
        <RunsList
          runs={filteredRuns}
          loading={loading}
          error={error}
          total={effectiveTotal}
          page={page}
          onPageChange={(p) => void loadRuns(p)}
          onRunClick={handleRunClick}
          onCancelRun={(runId) => void handleCancelRun(runId)}
          cancellingRunId={cancelingRunId}
        />
        </section>
      </div>
    </AppShell>
  );
}
