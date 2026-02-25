import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../components/Layout/AppShell';
import { apiClient } from '../api/client';
import { useAppPreferences } from '../context/AppPreferencesContext';
import { useLocaleText } from '../i18n/useLocaleText';
import type { Event } from '../types/events';
import type { RunMeta } from '../types';
import styles from './InboxPage.module.css';

interface ApprovalCandidate {
  run: RunMeta;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
  riskLevel: string;
  trace: string[];
}

function sanitizeSessionPart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_]/g, '_');
  return normalized || 'default';
}

function extractApproval(run: RunMeta, events: Event[]): ApprovalCandidate | null {
  const approvalEvents = events
    .filter(event => event.type === 'tool.requires_approval')
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  const latest = approvalEvents[0];
  if (!latest || latest.type !== 'tool.requires_approval') {
    return null;
  }

  const payload = latest.payload as {
    tool_call_id?: string;
    toolName?: string;
    args?: Record<string, unknown>;
    reason?: string;
    risk_level?: string;
  };
  if (!payload.tool_call_id || !payload.toolName) {
    return null;
  }

  const trace = events
    .filter(event => event.type === 'message.proposal' || event.type === 'message.status')
    .slice(-3)
    .map((event) => JSON.stringify(event.payload).slice(0, 280));

  return {
    run,
    toolCallId: payload.tool_call_id,
    toolName: payload.toolName,
    args: payload.args ?? {},
    reason: payload.reason ?? '',
    riskLevel: payload.risk_level ?? 'medium',
    trace,
  };
}

export function InboxPage() {
  const { t } = useLocaleText();
  const navigate = useNavigate();
  const { sessionHistory, tenantScope } = useAppPreferences();
  const [items, setItems] = useState<ApprovalCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reasonByRun, setReasonByRun] = useState<Record<string, string>>({});
  const [argsByRun, setArgsByRun] = useState<Record<string, string>>({});
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const emulatorSession = `s_emulator_${sanitizeSessionPart(tenantScope.userId)}`;
      const sessions = [emulatorSession, ...sessionHistory]
        .filter((value, index, list) => list.indexOf(value) === index)
        .slice(0, 12);
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

      const candidates = runResults
        .flat()
        .filter(run => run.status === 'suspended' || run.status === 'waiting')
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
        .slice(0, 30);

      const itemsResult = await Promise.all(
        candidates.map(async (run) => {
          try {
            const events = await apiClient.getEvents(run.run_id, undefined, {
              includeTokens: false,
              pageLimit: 300,
            });
            return extractApproval(run, events);
          } catch {
            return null;
          }
        }),
      );

      const nextItems = itemsResult.filter((item): item is ApprovalCandidate => item !== null);
      setItems(nextItems);
      setArgsByRun(prev => {
        const next = { ...prev };
        nextItems.forEach((item) => {
          if (!next[item.run.run_id]) {
            next[item.run.run_id] = JSON.stringify(item.args, null, 2);
          }
        });
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to load inbox', '加载审批中心失败'));
    } finally {
      setLoading(false);
    }
  }, [sessionHistory, t, tenantScope.userId]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const handleApprove = useCallback(async (item: ApprovalCandidate) => {
    setBusyRunId(item.run.run_id);
    setInfo(null);
    try {
      // Backend currently resumes with original tool args.
      await apiClient.approveToolCall(item.run.run_id, item.toolCallId);
      setInfo(t('Approved. Run resumed in queue.', '已同意，Run 已重新进入队列。'));
      await loadInbox();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Approve failed', '审批失败'));
    } finally {
      setBusyRunId(null);
    }
  }, [loadInbox, t]);

  const handleReject = useCallback(async (item: ApprovalCandidate) => {
    setBusyRunId(item.run.run_id);
    setInfo(null);
    try {
      await apiClient.rejectToolCall(item.run.run_id, item.toolCallId, reasonByRun[item.run.run_id]);
      setInfo(t('Rejected. Run resumed with rejection signal.', '已拒绝，Run 将带拒绝信号继续执行。'));
      await loadInbox();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Reject failed', '拒绝失败'));
    } finally {
      setBusyRunId(null);
    }
  }, [loadInbox, reasonByRun, t]);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => new Date(b.run.started_at).getTime() - new Date(a.run.started_at).getTime()),
    [items],
  );

  return (
    <AppShell
      title={t('Human-in-the-Loop Inbox', '人机协同审批中心')}
      subtitle={t(
        'Review suspended runs and decide how tool calls continue',
        '集中处理 suspended/waiting 运行的工具审批',
      )}
      actions={(
        <button className={styles.refreshButton} onClick={() => void loadInbox()}>
          {t('Refresh', '刷新')}
        </button>
      )}
    >
      <div className={styles.layout}>
        {loading && <p className={styles.placeholder}>{t('Loading approvals...', '正在加载审批项...')}</p>}
        {error && <p className={styles.error}>{error}</p>}
        {info && <p className={styles.info}>{info}</p>}

        {!loading && sortedItems.length === 0 && (
          <p className={styles.placeholder}>{t('No approvals waiting now', '当前没有待审批任务')}</p>
        )}

        {!loading && sortedItems.map((item) => {
          const runId = item.run.run_id;
          const isBusy = busyRunId === runId;
          return (
            <article key={runId} className={styles.card}>
              <header className={styles.cardHeader}>
                <div>
                  <h3>{item.toolName}</h3>
                  <p>{runId}</p>
                </div>
                <span className={`${styles.risk} ${styles[item.riskLevel] ?? styles.medium}`}>
                  {item.riskLevel}
                </span>
              </header>

              <p className={styles.reason}>
                <strong>{t('Agent intent', 'Agent 意图')}:</strong> {item.reason || t('No reason provided', '未提供原因')}
              </p>

              <label className={styles.field}>
                <span>{t('Tool Args (editable)', '工具参数（可编辑）')}</span>
                <textarea
                  className={styles.textarea}
                  value={argsByRun[runId] ?? JSON.stringify(item.args, null, 2)}
                  onChange={event => setArgsByRun(prev => ({ ...prev, [runId]: event.target.value }))}
                />
                <small>
                  {t(
                    'Current backend approves original args; edited args are for review context.',
                    '当前后端审批仍使用原始参数；编辑值用于人工复核记录。',
                  )}
                </small>
              </label>

              {item.trace.length > 0 && (
                <div className={styles.traceBlock}>
                  <span>{t('Reasoning trace', '推理片段')}</span>
                  {item.trace.map((line, idx) => (
                    <code key={`${runId}_trace_${idx}`}>{line}</code>
                  ))}
                </div>
              )}

              <label className={styles.field}>
                <span>{t('Reject reason (optional)', '拒绝理由（可选）')}</span>
                <input
                  value={reasonByRun[runId] ?? ''}
                  onChange={event => setReasonByRun(prev => ({ ...prev, [runId]: event.target.value }))}
                  placeholder={t('Explain why this should be denied', '说明拒绝原因')}
                />
              </label>

              <div className={styles.actions}>
                <button
                  className={styles.viewButton}
                  onClick={() => navigate(`/trace/${runId}`)}
                >
                  {t('View Trace', '查看轨迹')}
                </button>
                <button
                  className={styles.rejectButton}
                  onClick={() => void handleReject(item)}
                  disabled={isBusy}
                >
                  {t('Reject', '拒绝')}
                </button>
                <button
                  className={styles.approveButton}
                  onClick={() => void handleApprove(item)}
                  disabled={isBusy}
                >
                  {isBusy ? t('Processing...', '处理中...') : t('Approve', '同意')}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </AppShell>
  );
}
