import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EventList } from '../components/Trace';
import { apiClient } from '../api/client';
import { useSSE } from '../hooks/useSSE';
import { useLocaleText } from '../i18n/useLocaleText';
import type { RunMeta } from '../types';
import type { Event } from '../types/events';
import { AppShell } from '../components/Layout/AppShell';
import styles from './TracePage.module.css';

type TraceTab = 'tree' | 'waterfall' | 'events';

interface StepSummary {
  stepId: string;
  llmDuration: number;
  tokens: number;
  toolCalls: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
    isError?: boolean;
  }>;
  checkpointSignals: string[];
}

function parseStepIndex(stepId: string): number {
  const match = stepId.match(/[0-9]+/);
  return match ? Number.parseInt(match[0], 10) : Number.MAX_SAFE_INTEGER;
}

function collectStepSummaries(events: Event[]): StepSummary[] {
  const byStep = new Map<string, Event[]>();
  events.forEach((event) => {
    const key = event.step_id || 'step_unknown';
    if (!byStep.has(key)) {
      byStep.set(key, []);
    }
    byStep.get(key)?.push(event);
  });

  const summaries: StepSummary[] = [];
  byStep.forEach((stepEvents, stepId) => {
    const llmEvents = stepEvents.filter(event => event.type === 'llm.called');
    const llmDuration = llmEvents.reduce((acc, event) => {
      const payload = event.payload as { duration_ms?: number };
      return acc + (payload.duration_ms ?? 0);
    }, 0);
    const tokens = llmEvents.reduce((acc, event) => {
      const payload = event.payload as { totalTokens?: number };
      return acc + (payload.totalTokens ?? 0);
    }, 0);

    const toolCalled = stepEvents.filter(event => event.type === 'tool.called');
    const toolResults = stepEvents.filter(event => event.type === 'tool.result');
    const resultByParent = new Map<string, Event>();
    toolResults.forEach((event) => {
      if (event.parent_span_id) {
        resultByParent.set(event.parent_span_id, event);
      }
    });

    const toolCalls = toolCalled.map((event, index) => {
      const payload = event.payload as {
        toolName?: string;
        args?: Record<string, unknown>;
      };
      const resultEvent = resultByParent.get(event.span_id) ?? toolResults[index];
      const resultPayload = resultEvent?.payload as { result?: unknown; isError?: boolean } | undefined;
      return {
        toolName: payload.toolName ?? 'unknown',
        args: payload.args ?? {},
        ...(resultPayload?.result !== undefined ? { result: resultPayload.result } : {}),
        ...(resultPayload?.isError !== undefined ? { isError: resultPayload.isError } : {}),
      };
    });

    const checkpointSignals = stepEvents
      .filter(event => event.type === 'run.suspended' || event.type === 'run.resumed')
      .map(event => `${event.type} @ ${new Date(event.ts).toLocaleTimeString()}`);

    summaries.push({
      stepId,
      llmDuration,
      tokens,
      toolCalls,
      checkpointSignals,
    });
  });

  return summaries.sort((a, b) => parseStepIndex(a.stepId) - parseStepIndex(b.stepId));
}

export function TracePage() {
  const { runId } = useParams<{ runId: string }>();
  const { t } = useLocaleText();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TraceTab>('tree');
  const [runsById, setRunsById] = useState<Record<string, RunMeta>>({});
  const [eventsByRun, setEventsByRun] = useState<Record<string, Event[]>>({});
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [collapsedRunIds, setCollapsedRunIds] = useState<Record<string, boolean>>({});

  const { events: liveEvents, isConnected } = useSSE(runId ?? null);

  const loadTrace = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    try {
      const visited = new Set<string>();
      const queue = [runId];
      const runMap: Record<string, RunMeta> = {};
      const eventMap: Record<string, Event[]> = {};

      while (queue.length > 0) {
        const currentRunId = queue.shift();
        if (!currentRunId || visited.has(currentRunId)) {
          continue;
        }
        visited.add(currentRunId);

        const [meta, events, children] = await Promise.all([
          runMap[currentRunId] ? Promise.resolve(runMap[currentRunId]!) : apiClient.getRun(currentRunId),
          apiClient.getEvents(currentRunId, undefined, { includeTokens: false, pageLimit: 500 }),
          apiClient.getChildRuns(currentRunId),
        ]);

        runMap[currentRunId] = meta;
        eventMap[currentRunId] = events;

        children.forEach((child) => {
          runMap[child.run_id] = child;
          if (!visited.has(child.run_id)) {
            queue.push(child.run_id);
          }
        });
      }

      setRunsById(runMap);
      setEventsByRun(eventMap);
      setSelectedRunId(prev => prev || runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to load trace', '加载轨迹失败'));
    } finally {
      setLoading(false);
    }
  }, [runId, t]);

  useEffect(() => {
    void loadTrace();
  }, [loadTrace]);

  useEffect(() => {
    if (!runId || liveEvents.length === 0) return;
    setEventsByRun(prev => {
      const base = prev[runId] ?? [];
      const seen = new Set(base.map(event => event.span_id));
      const merged = [...base];
      liveEvents.forEach((event) => {
        if (!seen.has(event.span_id)) {
          merged.push(event);
          seen.add(event.span_id);
        }
      });
      return {
        ...prev,
        [runId]: merged,
      };
    });
  }, [liveEvents, runId]);

  const allRuns = useMemo(
    () => Object.values(runsById).sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()),
    [runsById],
  );

  const childrenByParent = useMemo(() => {
    const map: Record<string, string[]> = {};
    allRuns.forEach((run) => {
      const parent = run.parent_run_id ?? '__root__';
      if (!map[parent]) {
        map[parent] = [];
      }
      map[parent]!.push(run.run_id);
    });
    Object.keys(map).forEach((parent) => {
      map[parent]!.sort((a, b) => new Date(runsById[a]!.started_at).getTime() - new Date(runsById[b]!.started_at).getTime());
    });
    return map;
  }, [allRuns, runsById]);

  const rootRunIds = useMemo(() => {
    const fromMap = childrenByParent['__root__'] ?? [];
    if (fromMap.length > 0) return fromMap;
    return runId ? [runId] : [];
  }, [childrenByParent, runId]);

  const selectedRunEvents = useMemo(
    () => (selectedRunId ? (eventsByRun[selectedRunId] ?? []) : []),
    [eventsByRun, selectedRunId],
  );
  const stepSummaries = useMemo(() => collectStepSummaries(selectedRunEvents), [selectedRunEvents]);
  const selectedStep = stepSummaries.find(step => step.stepId === selectedStepId) ?? null;

  const flattenedEvents = useMemo(
    () => Object.values(eventsByRun).flat().sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()),
    [eventsByRun],
  );

  const timeline = useMemo(() => {
    if (allRuns.length === 0) return [];
    const base = Math.min(...allRuns.map(run => new Date(run.started_at).getTime()));
    const end = Math.max(...allRuns.map((run) => {
      if (run.ended_at) return new Date(run.ended_at).getTime();
      return new Date(run.started_at).getTime() + (run.duration_ms ?? 1000);
    }));
    const total = Math.max(end - base, 1);

    return allRuns.map((run) => {
      const start = new Date(run.started_at).getTime();
      const runEnd = run.ended_at
        ? new Date(run.ended_at).getTime()
        : start + (run.duration_ms ?? 1000);
      const duration = Math.max(runEnd - start, 1);
      return {
        run,
        left: ((start - base) / total) * 100,
        width: (duration / total) * 100,
      };
    });
  }, [allRuns]);

  const summary = useMemo(() => {
    const totalEvents = flattenedEvents.length;
    const llmCalls = flattenedEvents.filter(event => event.type === 'llm.called').length;
    const toolCalls = flattenedEvents.filter(event => event.type === 'tool.called').length;
    const suspendedSignals = flattenedEvents.filter(event => event.type === 'run.suspended').length;
    return { totalEvents, llmCalls, toolCalls, suspendedSignals };
  }, [flattenedEvents]);

  const toggleRunCollapse = (id: string) => {
    setCollapsedRunIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const renderRunTree = (nodeRunId: string, depth: number): JSX.Element => {
    const run = runsById[nodeRunId];
    if (!run) {
      return <></>;
    }
    const children = childrenByParent[nodeRunId] ?? [];
    const collapsed = collapsedRunIds[nodeRunId] ?? false;
    return (
      <div key={nodeRunId}>
        <button
          className={`${styles.treeNode} ${selectedRunId === nodeRunId ? styles.treeNodeActive : ''}`}
          style={{ paddingLeft: `${12 + depth * 18}px` }}
          onClick={() => {
            setSelectedRunId(nodeRunId);
            setSelectedStepId(null);
          }}
        >
          <span className={styles.treeNodeMain}>
            <strong>{nodeRunId}</strong>
            <em>{run.status}</em>
          </span>
          {children.length > 0 && (
            <span
              className={styles.collapseButton}
              onClick={(event) => {
                event.stopPropagation();
                toggleRunCollapse(nodeRunId);
              }}
            >
              {collapsed ? '+' : '-'}
            </span>
          )}
        </button>
        {!collapsed && children.map(childRunId => renderRunTree(childRunId, depth + 1))}
      </div>
    );
  };

  if (!runId) {
    return (
      <AppShell title={t('Trace Viewer', '追踪查看器')} subtitle={t('Run details', '运行详情')}>
        <div className={styles.errorBox}>{t('Run ID is required.', '缺少 Run ID。')}</div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={t('Trace / DAG / Waterfall', '轨迹 / DAG / 瀑布流')}
      subtitle={isConnected ? t('Live stream connected', '实时流已连接') : t('Replaying stored events', '展示已落盘事件')}
      actions={(
        <button className={styles.pageAction} onClick={() => void loadTrace()}>
          {t('Reload', '重新加载')}
        </button>
      )}
    >
      <div className={styles.layout}>
        <section className={styles.summaryGrid}>
          <article className={styles.summaryCard}>
            <span>{t('Runs in Graph', '图中 Run 数')}</span>
            <strong>{allRuns.length}</strong>
          </article>
          <article className={styles.summaryCard}>
            <span>{t('Total Events', '总事件')}</span>
            <strong>{summary.totalEvents}</strong>
          </article>
          <article className={styles.summaryCard}>
            <span>{t('LLM Calls', 'LLM 调用')}</span>
            <strong>{summary.llmCalls}</strong>
          </article>
          <article className={styles.summaryCard}>
            <span>{t('Tool Calls', '工具调用')}</span>
            <strong>{summary.toolCalls}</strong>
          </article>
          <article className={styles.summaryCard}>
            <span>{t('Suspensions', '挂起次数')}</span>
            <strong>{summary.suspendedSignals}</strong>
          </article>
        </section>

        <section className={styles.switchRow}>
          <button
            className={tab === 'tree' ? styles.switchActive : styles.switchButton}
            onClick={() => setTab('tree')}
          >
            {t('Run Tree / DAG', 'Run 树 / DAG')}
          </button>
          <button
            className={tab === 'waterfall' ? styles.switchActive : styles.switchButton}
            onClick={() => setTab('waterfall')}
          >
            {t('Waterfall', '并发瀑布流')}
          </button>
          <button
            className={tab === 'events' ? styles.switchActive : styles.switchButton}
            onClick={() => setTab('events')}
          >
            {t('Raw Events', '原始事件')}
          </button>
        </section>

        {loading && <div className={styles.loading}>{t('Loading trace...', '正在加载追踪...')}</div>}
        {error && <div className={styles.errorBox}>{error}</div>}

        {!loading && !error && tab === 'tree' && (
          <div className={styles.mainGrid}>
            <div className={styles.treePanel}>
              <h3>{t('Run Tree', 'Run 树')}</h3>
              {rootRunIds.map(root => renderRunTree(root, 0))}
              <div className={styles.stepList}>
                <h4>{t('Step Detail Entry', '步骤入口')}</h4>
                {stepSummaries.length === 0 && (
                  <p className={styles.placeholder}>{t('No steps found', '未找到步骤')}</p>
                )}
                {stepSummaries.map(step => (
                  <button
                    key={step.stepId}
                    className={selectedStepId === step.stepId ? styles.stepButtonActive : styles.stepButton}
                    onClick={() => setSelectedStepId(step.stepId)}
                  >
                    <span>{step.stepId}</span>
                    <em>{step.tokens} tok</em>
                  </button>
                ))}
              </div>
            </div>

            <aside className={styles.drawer}>
              <h3>{t('Step Drawer', 'Step 抽屉')}</h3>
              {!selectedStep && (
                <p className={styles.placeholder}>{t('Select a step from the left tree.', '从左侧选择一个步骤。')}</p>
              )}
              {selectedStep && (
                <>
                  <div className={styles.drawerMeta}>
                    <span>{selectedStep.stepId}</span>
                    <span>{selectedStep.llmDuration}ms LLM</span>
                    <span>{selectedStep.tokens} tokens</span>
                  </div>
                  <div className={styles.drawerSection}>
                    <h4>{t('Tool Calls', '工具调用')}</h4>
                    {selectedStep.toolCalls.length === 0 && (
                      <p className={styles.placeholder}>{t('No tools in this step', '该步骤没有工具调用')}</p>
                    )}
                    {selectedStep.toolCalls.map((tool, idx) => (
                      <article key={`${tool.toolName}_${idx}`} className={styles.toolCard}>
                        <header>
                          <strong>{tool.toolName}</strong>
                          {tool.isError && <em>{t('error', '错误')}</em>}
                        </header>
                        <pre>{JSON.stringify(tool.args, null, 2)}</pre>
                        {tool.result !== undefined && (
                          <pre>{JSON.stringify(tool.result, null, 2)}</pre>
                        )}
                      </article>
                    ))}
                  </div>
                  <div className={styles.drawerSection}>
                    <h4>{t('Checkpoint Signals', 'Checkpoint 信号')}</h4>
                    {selectedStep.checkpointSignals.length === 0 && (
                      <p className={styles.placeholder}>{t('No checkpoint events', '没有 checkpoint 事件')}</p>
                    )}
                    {selectedStep.checkpointSignals.map(signal => (
                      <code key={signal}>{signal}</code>
                    ))}
                  </div>
                </>
              )}
            </aside>
          </div>
        )}

        {!loading && !error && tab === 'waterfall' && (
          <div className={styles.panel}>
            <h3>{t('Concurrent Waterfall', '并发瀑布流')}</h3>
            {timeline.map(item => (
              <div key={item.run.run_id} className={styles.waterfallRow}>
                <div className={styles.waterfallLabel}>
                  <strong>{item.run.run_id}</strong>
                  <span>{item.run.status}</span>
                </div>
                <div className={styles.waterfallTrack}>
                  <div
                    className={styles.waterfallBar}
                    style={{ left: `${item.left}%`, width: `${Math.max(item.width, 1)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && tab === 'events' && (
          <div className={styles.panel}>
            <EventList events={flattenedEvents} />
          </div>
        )}
      </div>
    </AppShell>
  );
}
