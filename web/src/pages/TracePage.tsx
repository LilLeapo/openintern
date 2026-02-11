import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { TraceView, EventList } from '../components/Trace';
import { apiClient } from '../api/client';
import { useSSE } from '../hooks/useSSE';
import { useLocaleText } from '../i18n/useLocaleText';
import type { Event } from '../types/events';
import { AppShell } from '../components/Layout/AppShell';
import styles from './TracePage.module.css';

const EVENT_FILTERS: Array<Event['type'] | 'all'> = [
  'all',
  'run.started',
  'step.started',
  'step.completed',
  'llm.called',
  'llm.token',
  'tool.called',
  'tool.result',
  'run.completed',
  'run.failed',
];

export function TracePage() {
  const { runId } = useParams<{ runId: string }>();
  const { t } = useLocaleText();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [viewMode, setViewMode] = useState<'steps' | 'events'>('steps');
  const [eventFilter, setEventFilter] = useState<Event['type'] | 'all'>('all');

  // SSE for real-time updates
  const { events: sseEvents, isConnected, error: sseError } = useSSE(runId ?? null);

  // Load initial events
  const loadEvents = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getEvents(runId);
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(t('Failed to load', '加载失败')));
    } finally {
      setLoading(false);
    }
  }, [runId, t]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  // Merge SSE events
  useEffect(() => {
    if (sseEvents.length > 0) {
      setEvents((prev) => {
        const existingIds = new Set(prev.map((e) => e.span_id));
        const newEvents = sseEvents.filter((e) => !existingIds.has(e.span_id));
        return [...prev, ...newEvents];
      });
    }
  }, [sseEvents]);

  if (!runId) {
    return (
      <AppShell title={t('Trace Viewer', '追踪查看器')} subtitle={t('Run details', '运行详情')}>
        <div className={styles.errorBox}>{t('Run ID is required.', '缺少 Run ID。')}</div>
      </AppShell>
    );
  }

  const visibleEvents = eventFilter === 'all'
    ? events
    : events.filter(event => event.type === eventFilter);

  const stepCount = new Set(events.map(event => event.step_id)).size;
  const toolCalls = events.filter(event => event.type === 'tool.called').length;
  const llmCalls = events.filter(event => event.type === 'llm.called').length;
  const runStarted = events.find(event => event.type === 'run.started');
  const runFinished = events.find(
    event => event.type === 'run.completed' || event.type === 'run.failed',
  );
  const durationText = (() => {
    if (!runStarted) return t('N/A', '无');
    const endTs = runFinished ? new Date(runFinished.ts).getTime() : Date.now();
    const startTs = new Date(runStarted.ts).getTime();
    const elapsed = Math.max(0, endTs - startTs);
    if (elapsed < 1000) return `${elapsed}ms`;
    return `${(elapsed / 1000).toFixed(2)}s`;
  })();

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(visibleEvents, null, 2)], {
      type: 'application/json',
    });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `trace-${runId}-${eventFilter}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <AppShell
      title={`Trace ${runId}`}
      subtitle={isConnected ? t('Live stream connected', '实时流已连接') : t('Awaiting live stream', '等待实时流连接')}
      actions={
        <>
          <button className={styles.pageAction} onClick={() => void loadEvents()}>
            {t('Reload', '重新加载')}
          </button>
          <button className={styles.pageActionSecondary} onClick={exportJson}>
            {t('Export JSON', '导出 JSON')}
          </button>
        </>
      }
    >
      <div className={styles.layout}>
        <section className={styles.summaryGrid}>
          <article className={styles.summaryCard}>
            <span>{t('Total Events', '事件总数')}</span>
            <strong>{events.length}</strong>
          </article>
          <article className={styles.summaryCard}>
            <span>{t('Steps', '步骤')}</span>
            <strong>{stepCount}</strong>
          </article>
          <article className={styles.summaryCard}>
            <span>{t('Tool Calls', '工具调用')}</span>
            <strong>{toolCalls}</strong>
          </article>
          <article className={styles.summaryCard}>
            <span>{t('LLM Calls', '模型调用')}</span>
            <strong>{llmCalls}</strong>
          </article>
          <article className={styles.summaryCard}>
            <span>{t('Elapsed', '耗时')}</span>
            <strong>{durationText}</strong>
          </article>
        </section>
        <section className={styles.controlsCard}>
          <div className={styles.badges}>
            <span className={`${styles.badge} ${isConnected ? styles.badgeOk : styles.badgeWarn}`}>
              {isConnected ? t('Live', '实时') : t('Disconnected', '已断开')}
            </span>
            {sseError && <span className={`${styles.badge} ${styles.badgeError}`}>{sseError.message}</span>}
          </div>
          <div className={styles.switchGroup}>
            <button
              className={`${styles.switchButton} ${viewMode === 'steps' ? styles.switchButtonActive : ''}`}
              onClick={() => setViewMode('steps')}
            >
              {t('Steps', '步骤')}
            </button>
            <button
              className={`${styles.switchButton} ${viewMode === 'events' ? styles.switchButtonActive : ''}`}
              onClick={() => setViewMode('events')}
            >
              {t('Raw Events', '原始事件')}
            </button>
          </div>
          <select
            className={styles.select}
            value={eventFilter}
            onChange={e => setEventFilter(e.target.value as Event['type'] | 'all')}
            aria-label={t('Filter events by type', '按类型筛选事件')}
          >
            {EVENT_FILTERS.map(filter => (
              <option key={filter} value={filter}>
                {filter}
              </option>
            ))}
          </select>
        </section>
        <section className={styles.traceSection}>
        {loading ? (
          <div className={styles.loading}>{t('Loading trace...', '正在加载追踪...')}</div>
        ) : error ? (
          <div className={styles.errorBox}>{error.message}</div>
        ) : (
          <>
            {viewMode === 'steps' ? (
              <TraceView events={events} runId={runId} eventFilter={eventFilter} />
            ) : (
              <EventList
                events={visibleEvents}
              />
            )}
          </>
        )}
        </section>
      </div>
    </AppShell>
  );
}
