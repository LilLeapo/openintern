import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../components/Layout/AppShell';
import { apiClient, APIError } from '../api/client';
import type { SwarmStatusSnapshot } from '../api/client';
import { useSSE } from '../hooks/useSSE';
import { useLocaleText } from '../i18n/useLocaleText';
import { useAppPreferences } from '../context/AppPreferencesContext';
import { recordRunScope } from '../utils/runScopeRegistry';
import type { Event } from '../types/events';
import type { Group } from '../types';
import styles from './EmulatorPage.module.css';

interface EmulatorMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: string;
}

interface InjectedMemory {
  id: string;
  fact: string;
  weight: number;
}

interface PendingApprovalItem {
  runId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
  riskLevel: string;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function classifyRoute(events: Event[]): string {
  const toolEvents = events.filter(event => event.type === 'tool.called');
  const names = toolEvents.map(event => {
    const payload = event.payload as { toolName?: string };
    return payload.toolName ?? '';
  });
  if (names.some(name => name.includes('dispatch_subtasks'))) {
    return 'dispatch_subtasks';
  }
  if (names.some(name => name.includes('handoff_to'))) {
    return 'handoff_to';
  }
  if (names.some(name => name.includes('memory_search'))) {
    return 'memory_search';
  }
  if (names.length === 0) {
    return 'direct';
  }
  return names[0] ?? 'direct';
}

function sanitizeSessionPart(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_]/g, '_');
  return normalized || 'default';
}

function isSwarmToolName(toolName: string): boolean {
  return (
    toolName === 'dispatch_subtasks'
    || toolName === 'handoff_to'
    || toolName === 'escalate_to_group'
  );
}

function extractPendingApproval(runId: string, events: Event[]): PendingApprovalItem | null {
  const resolvedToolCalls = new Set<string>();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;
    if (event.type === 'tool.approved' || event.type === 'tool.rejected') {
      const payload = event.payload as { tool_call_id?: string };
      if (payload.tool_call_id) {
        resolvedToolCalls.add(payload.tool_call_id);
      }
      continue;
    }
    if (event.type !== 'tool.requires_approval') continue;
    const payload = event.payload as {
      tool_call_id?: string;
      toolName?: string;
      args?: Record<string, unknown>;
      reason?: string;
      risk_level?: string;
    };
    if (!payload.tool_call_id || !payload.toolName) {
      continue;
    }
    if (resolvedToolCalls.has(payload.tool_call_id)) {
      continue;
    }
    return {
      runId,
      toolCallId: payload.tool_call_id,
      toolName: payload.toolName,
      args: payload.args ?? {},
      reason: payload.reason ?? '',
      riskLevel: payload.risk_level ?? 'high',
    };
  }
  return null;
}

export function EmulatorPage() {
  const { t } = useLocaleText();
  const { tenantScope, setTenantScope } = useAppPreferences();

  const [orgIdDraft, setOrgIdDraft] = useState(tenantScope.orgId);
  const [userIdDraft, setUserIdDraft] = useState(tenantScope.userId);
  const [projectIdDraft, setProjectIdDraft] = useState(tenantScope.projectId ?? '');

  const [messages, setMessages] = useState<EmulatorMessage[]>([]);
  const [input, setInput] = useState('');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(true);
  const [eventLog, setEventLog] = useState<Event[]>([]);
  const [injectedMemories, setInjectedMemories] = useState<InjectedMemory[]>([]);
  const [memoryFact, setMemoryFact] = useState('');
  const [memoryWeight, setMemoryWeight] = useState(0.9);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asyncStatus, setAsyncStatus] = useState<'idle' | 'waiting' | 'resumed'>('idle');
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const [swarmSnapshot, setSwarmSnapshot] = useState<SwarmStatusSnapshot | null>(null);
  const [swarmError, setSwarmError] = useState<string | null>(null);
  const [swarmUpdatedAt, setSwarmUpdatedAt] = useState<string | null>(null);
  const [swarmMonitorEnabled, setSwarmMonitorEnabled] = useState(false);
  const [swarmApiUnsupported, setSwarmApiUnsupported] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalItem[]>([]);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvalReasonByKey, setApprovalReasonByKey] = useState<Record<string, string>>({});
  const [approvalBusyKey, setApprovalBusyKey] = useState<string | null>(null);
  const [approvalReloadTick, setApprovalReloadTick] = useState(0);

  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [syncingGroups, setSyncingGroups] = useState(false);
  const showSwarmMonitor = swarmMonitorEnabled && !swarmApiUnsupported;

  const streamingMessageIdRef = useRef<string | null>(null);
  const processedEventCountRef = useRef(0);
  const { events } = useSSE(activeRunId);

  useEffect(() => {
    setOrgIdDraft(tenantScope.orgId);
    setUserIdDraft(tenantScope.userId);
    setProjectIdDraft(tenantScope.projectId ?? '');
  }, [tenantScope.orgId, tenantScope.userId, tenantScope.projectId]);

  const loadProjectGroups = useCallback(async () => {
    setLoadingGroups(true);
    setGroupError(null);
    try {
      const nextGroups = await apiClient.listGroups(tenantScope.projectId ?? undefined);
      setGroups(nextGroups);
      setSelectedGroupId(prev => {
        if (prev && nextGroups.some(group => group.id === prev)) {
          return prev;
        }
        return nextGroups[0]?.id ?? '';
      });
    } catch (err) {
      setGroups([]);
      setSelectedGroupId('');
      setGroupError(err instanceof Error ? err.message : t('Failed to load groups', '加载群组失败'));
    } finally {
      setLoadingGroups(false);
    }
  }, [tenantScope.projectId, t]);

  useEffect(() => {
    void loadProjectGroups();
  }, [loadProjectGroups]);

  useEffect(() => {
    processedEventCountRef.current = 0;
    streamingMessageIdRef.current = null;
    setSwarmSnapshot(null);
    setSwarmError(null);
    setSwarmUpdatedAt(null);
    setSwarmMonitorEnabled(false);
    setPendingApprovals([]);
    setApprovalError(null);
    setApprovalReasonByKey({});
    setApprovalBusyKey(null);
  }, [activeRunId]);

  useEffect(() => {
    if (!activeRunId || !swarmMonitorEnabled || swarmApiUnsupported) {
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    const loadSwarmStatus = async () => {
      try {
        const snapshot = await apiClient.getSwarmStatus(activeRunId);
        if (cancelled) return;
        setSwarmSnapshot(snapshot);
        setSwarmError(null);
        setSwarmUpdatedAt(new Date().toISOString());
        if (
          timerId !== null &&
          snapshot.summary.pending === 0 &&
          (snapshot.parent_status === 'completed'
            || snapshot.parent_status === 'failed'
            || snapshot.parent_status === 'cancelled')
        ) {
          window.clearInterval(timerId);
          timerId = null;
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof APIError && err.statusCode === 404) {
          setSwarmApiUnsupported(true);
          setSwarmMonitorEnabled(false);
          setSwarmError(null);
          return;
        }
        setSwarmError(err instanceof Error ? err.message : t('Failed to load swarm status', '加载 Swarm 状态失败'));
      }
    };

    void loadSwarmStatus();
    timerId = window.setInterval(() => {
      void loadSwarmStatus();
    }, 1500);

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearInterval(timerId);
      }
    };
  }, [activeRunId, swarmMonitorEnabled, swarmApiUnsupported, t]);

  useEffect(() => {
    if (!activeRunId || !showSwarmMonitor) {
      setPendingApprovals([]);
      setApprovalError(null);
      return;
    }

    const candidateRunIds = new Set<string>();
    candidateRunIds.add(activeRunId);
    if (swarmSnapshot) {
      if (swarmSnapshot.parent_status === 'suspended' || swarmSnapshot.parent_status === 'waiting') {
        candidateRunIds.add(swarmSnapshot.parent_run_id);
      }
      for (const dep of swarmSnapshot.dependencies) {
        if (dep.child_status === 'suspended' || dep.child_status === 'waiting') {
          candidateRunIds.add(dep.child_run_id);
        }
      }
    }

    if (candidateRunIds.size === 0) {
      setPendingApprovals([]);
      setApprovalError(null);
      return;
    }

    let cancelled = false;
    const loadPendingApprovals = async () => {
      try {
        const ids = [...candidateRunIds];
        const items = await Promise.all(
          ids.map(async (runId) => {
            try {
              const events = await apiClient.getEvents(runId, undefined, {
                includeTokens: false,
                pageLimit: 400,
              });
              return extractPendingApproval(runId, events);
            } catch {
              return null;
            }
          })
        );
        if (cancelled) return;
        const approvals = items.filter((item): item is PendingApprovalItem => item !== null);
        setPendingApprovals(approvals);
        setApprovalError(null);
      } catch (err) {
        if (cancelled) return;
        setApprovalError(
          err instanceof Error
            ? err.message
            : t('Failed to load pending approvals', '加载待审批项失败')
        );
      }
    };

    void loadPendingApprovals();
    return () => {
      cancelled = true;
    };
  }, [activeRunId, showSwarmMonitor, swarmSnapshot, approvalReloadTick, t]);

  useEffect(() => {
    if (events.length === 0) return;

    setEventLog(events);

    const startIndex = Math.min(processedEventCountRef.current, events.length);
    const pendingEvents = events.slice(startIndex);

    for (const event of pendingEvents) {
      if (event.type === 'llm.token') {
        const payload = event.payload as { token?: string };
        const token = payload.token ?? '';
        if (!streamingMessageIdRef.current) {
          const id = genId('assistant_stream');
          streamingMessageIdRef.current = id;
          setMessages(prev => [...prev, {
            id,
            role: 'assistant',
            content: token,
            ts: event.ts,
          }]);
        } else {
          const streamId = streamingMessageIdRef.current;
          setMessages(prev => prev.map(message => (
            message.id === streamId
              ? { ...message, content: `${message.content}${token}` }
              : message
          )));
        }
        continue;
      }

      if (event.type === 'run.suspended' || event.type === 'tool.requires_approval') {
        if (event.type === 'run.suspended') {
          const payload = event.payload as { toolName?: string };
          if (payload.toolName && isSwarmToolName(payload.toolName)) {
            setSwarmMonitorEnabled(true);
          }
        }
        setAsyncStatus('waiting');
        setMessages(prev => [...prev, {
          id: genId('status_wait'),
          role: 'system',
          content: t('PA is waiting for background swarm result...', 'PA 正在等待后台 Swarm 结果...'),
          ts: new Date().toISOString(),
        }]);
        continue;
      }

      if (event.type === 'run.resumed') {
        setAsyncStatus('resumed');
        setMessages(prev => [...prev, {
          id: genId('status_resume'),
          role: 'system',
          content: t('PA resumed and is preparing final response.', 'PA 已恢复执行，正在准备最终回复。'),
          ts: new Date().toISOString(),
        }]);
        continue;
      }

      if (event.type === 'tool.called') {
        const payload = event.payload as { toolName?: string };
        if (payload.toolName && isSwarmToolName(payload.toolName)) {
          setSwarmMonitorEnabled(true);
        }
      }

      if (event.type === 'run.completed') {
        const payload = event.payload as { output?: string };
        const output = payload.output ?? '';
        const streamId = streamingMessageIdRef.current;

        if (streamId) {
          setMessages(prev => prev.map(message => (
            message.id === streamId
              ? { ...message, content: output, ts: event.ts }
              : message
          )));
        } else {
          setMessages(prev => [...prev, {
            id: genId('assistant_final'),
            role: 'assistant',
            content: output,
            ts: event.ts,
          }]);
        }
        streamingMessageIdRef.current = null;
        setSending(false);
        setAsyncStatus('idle');
        continue;
      }

      if (event.type === 'run.failed') {
        const payload = event.payload as { error?: { message?: string } };
        setMessages(prev => [...prev, {
          id: genId('assistant_error'),
          role: 'assistant',
          content: `Error: ${payload.error?.message ?? 'run failed'}`,
          ts: event.ts,
        }]);
        streamingMessageIdRef.current = null;
        setSending(false);
        setAsyncStatus('idle');
      }
    }

    processedEventCountRef.current = events.length;
  }, [events, t]);

  const routeHint = useMemo(() => classifyRoute(eventLog), [eventLog]);
  const swarmProgress = useMemo(() => {
    if (!swarmSnapshot || swarmSnapshot.summary.total === 0) return 0;
    const done = swarmSnapshot.summary.completed + swarmSnapshot.summary.failed;
    return Math.round((done / swarmSnapshot.summary.total) * 100);
  }, [swarmSnapshot]);
  const debugLogText = useMemo(
    () => (
      eventLog.length === 0
        ? t('No events yet.', '暂无事件流。')
        : eventLog.map(event => `[${event.type}] ${JSON.stringify(event.payload)}`).join('\n')
    ),
    [eventLog, t],
  );

  const emulatorSessionKey = useMemo(
    () => `s_emulator_${sanitizeSessionPart(tenantScope.userId)}`,
    [tenantScope.userId],
  );

  const refreshSwarmSnapshot = useCallback(async () => {
    if (!activeRunId || !showSwarmMonitor || swarmApiUnsupported) {
      return;
    }
    try {
      const snapshot = await apiClient.getSwarmStatus(activeRunId);
      setSwarmSnapshot(snapshot);
      setSwarmError(null);
      setSwarmUpdatedAt(new Date().toISOString());
    } catch (err) {
      if (err instanceof APIError && err.statusCode === 404) {
        setSwarmApiUnsupported(true);
        setSwarmMonitorEnabled(false);
        setSwarmError(null);
        return;
      }
      setSwarmError(err instanceof Error ? err.message : t('Failed to load swarm status', '加载 Swarm 状态失败'));
    }
  }, [activeRunId, showSwarmMonitor, swarmApiUnsupported, t]);

  const approvePending = useCallback(async (item: PendingApprovalItem) => {
    const key = `${item.runId}:${item.toolCallId}`;
    setApprovalBusyKey(key);
    setApprovalError(null);
    try {
      await apiClient.approveToolCall(item.runId, item.toolCallId);
      setMessages(prev => [...prev, {
        id: genId('approval_ok'),
        role: 'system',
        content: t(
          `Approved ${item.toolName} for ${item.runId}.`,
          `已同意 ${item.runId} 的 ${item.toolName} 调用。`
        ),
        ts: new Date().toISOString(),
      }]);
      setApprovalReloadTick(prev => prev + 1);
      await refreshSwarmSnapshot();
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : t('Approve failed', '审批失败'));
    } finally {
      setApprovalBusyKey(null);
    }
  }, [refreshSwarmSnapshot, t]);

  const rejectPending = useCallback(async (item: PendingApprovalItem) => {
    const key = `${item.runId}:${item.toolCallId}`;
    setApprovalBusyKey(key);
    setApprovalError(null);
    try {
      await apiClient.rejectToolCall(
        item.runId,
        item.toolCallId,
        approvalReasonByKey[key],
      );
      setMessages(prev => [...prev, {
        id: genId('approval_no'),
        role: 'system',
        content: t(
          `Rejected ${item.toolName} for ${item.runId}.`,
          `已拒绝 ${item.runId} 的 ${item.toolName} 调用。`
        ),
        ts: new Date().toISOString(),
      }]);
      setApprovalReloadTick(prev => prev + 1);
      await refreshSwarmSnapshot();
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : t('Reject failed', '拒绝失败'));
    } finally {
      setApprovalBusyKey(null);
    }
  }, [approvalReasonByKey, refreshSwarmSnapshot, t]);

  const addMemory = useCallback(() => {
    const fact = memoryFact.trim();
    if (!fact) return;
    setInjectedMemories(prev => [...prev, {
      id: genId('mem'),
      fact,
      weight: memoryWeight,
    }]);
    setMemoryFact('');
  }, [memoryFact, memoryWeight]);

  const applyScope = useCallback(() => {
    setTenantScope({
      orgId: orgIdDraft,
      userId: userIdDraft,
      projectId: projectIdDraft || null,
    });
  }, [orgIdDraft, projectIdDraft, setTenantScope, userIdDraft]);

  const bindUnscopedGroups = useCallback(async () => {
    if (!tenantScope.projectId) {
      setError(t('Set project_id first, then bind groups.', '请先设置 project_id，再执行绑定。'));
      return;
    }
    setSyncingGroups(true);
    setError(null);
    try {
      const result = await apiClient.assignGroupsProject(tenantScope.projectId, {
        includeExisting: false,
      });
      await loadProjectGroups();
      setMessages(prev => [...prev, {
        id: genId('scope_sync'),
        role: 'system',
        content: t(
          `Bound ${result.updated} group(s) to project ${result.project_id}.`,
          `已将 ${result.updated} 个群组绑定到项目 ${result.project_id}。`,
        ),
        ts: new Date().toISOString(),
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to bind groups', '绑定群组失败'));
    } finally {
      setSyncingGroups(false);
    }
  }, [loadProjectGroups, t, tenantScope.projectId]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    setSending(true);
    setAsyncStatus('idle');

    const memoryContext = injectedMemories.length > 0
      ? injectedMemories
          .map(memory => `- ${memory.fact} (weight=${memory.weight.toFixed(2)})`)
          .join('\n')
      : '';

    const groupHint = selectedGroupId
      ? `\n\n[Preferred Escalation Group]\nIf delegation is required, prefer group_id=${selectedGroupId}.`
      : '';

    const promptBody = memoryContext
      ? `${text}\n\n[Injected Episodic Memory]\n${memoryContext}\nPlease respect these user preferences if possible.`
      : text;

    const prompt = `${promptBody}${groupHint}`;

    setMessages(prev => [...prev, {
      id: genId('user'),
      role: 'user',
      content: text,
      ts: new Date().toISOString(),
    }]);
    setInput('');
    setEventLog([]);
    streamingMessageIdRef.current = null;
    setSwarmSnapshot(null);
    setSwarmError(null);
    setSwarmUpdatedAt(null);
    setSwarmMonitorEnabled(false);
    setSwarmApiUnsupported(false);
    setPendingApprovals([]);
    setApprovalError(null);
    setApprovalReasonByKey({});
    setApprovalBusyKey(null);
    setApprovalReloadTick(0);

    try {
      const response = await apiClient.createRun(
        emulatorSessionKey,
        prompt,
      );
      recordRunScope(response.run_id, apiClient.getScope());
      setActiveRunId(response.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to send', '发送失败'));
      setSending(false);
    }
  }, [emulatorSessionKey, injectedMemories, input, selectedGroupId, sending, t]);

  const handleCopyDebugLog = useCallback(async () => {
    const text = debugLogText;
    if (!text) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopyState('success');
    } catch {
      setCopyState('error');
    }

    window.setTimeout(() => {
      setCopyState('idle');
    }, 1200);
  }, [debugLogText]);

  return (
    <AppShell
      title={t('PA Emulator & Evaluation', 'PA 终端模拟与评测中心')}
      subtitle={t(
        'IM simulation, routing x-ray, episodic control, and async UX checks',
        'IM 模拟、路由透视、情景记忆注入与异步体验测试',
      )}
    >
      <div className={styles.layout}>
        <section className={styles.leftPane}>
          <header className={styles.toolbar}>
            <div className={styles.identityGrid}>
              <label>
                <span>org_id</span>
                <input value={orgIdDraft} onChange={event => setOrgIdDraft(event.target.value)} />
              </label>
              <label>
                <span>user_id</span>
                <input value={userIdDraft} onChange={event => setUserIdDraft(event.target.value)} />
              </label>
              <label>
                <span>project_id</span>
                <input
                  value={projectIdDraft}
                  onChange={event => setProjectIdDraft(event.target.value)}
                  placeholder={t('required for scoped groups', '群组按项目过滤时必填')}
                />
              </label>
              <label>
                <span>{t('Preferred Group', '优先群组')}</span>
                <select
                  value={selectedGroupId}
                  onChange={event => setSelectedGroupId(event.target.value)}
                  disabled={loadingGroups || groups.length === 0}
                >
                  {groups.length === 0 ? (
                    <option value="">{t('No project group', '当前项目无群组')}</option>
                  ) : (
                    <>
                      <option value="">{t('Auto-select by goal', '按目标自动选择')}</option>
                      {groups.map(group => (
                        <option key={group.id} value={group.id}>{group.name}</option>
                      ))}
                    </>
                  )}
                </select>
              </label>
            </div>

            <div className={styles.toolbarActions}>
              <button className={styles.applyButton} onClick={applyScope}>
                {t('Apply Scope', '应用 Scope')}
              </button>
              <button
                className={styles.secondaryAction}
                onClick={() => void bindUnscopedGroups()}
                disabled={!tenantScope.projectId || syncingGroups}
              >
                {syncingGroups
                  ? t('Binding...', '绑定中...')
                  : t('Bind Null project_id Groups', '将空 project_id 群组绑定到当前项目')}
              </button>
            </div>

            <div className={styles.tenantChip}>
              <strong>{tenantScope.orgId}</strong>
              <span>{tenantScope.projectId ?? 'null'}</span>
              <em>{tenantScope.userId}</em>
            </div>
          </header>

          {groupError && <p className={styles.error}>{groupError}</p>}

          <div className={styles.chatFrame}>
            <div className={styles.chatHeader}>
              <h3>{t('IM Environment Simulator', 'IM 沉浸式模拟器')}</h3>
              <div className={styles.chatMeta}>
                <span>{t('Session', '会话')}: {emulatorSessionKey}</span>
                <span>{t('Groups', '群组')}: {groups.length}</span>
              </div>
              {asyncStatus === 'waiting' && (
                <span className={styles.waitingHint}>
                  {t('Gathering experts...', '正在召集专家团队...')}
                </span>
              )}
            </div>
            <div className={styles.messages}>
              {messages.length === 0 && (
                <p className={styles.placeholder}>
                  {t(
                    'Try: "Summarize last month financial report and write a brief."',
                    '可试：帮我查上个月财报并写个总结。',
                  )}
                </p>
              )}
              {messages.map(message => (
                <article
                  key={message.id}
                  className={`${styles.message} ${styles[message.role] ?? ''}`}
                >
                  <p>{message.content}</p>
                </article>
              ))}
            </div>
            <div className={styles.inputBar}>
              <textarea
                value={input}
                onChange={event => setInput(event.target.value)}
                placeholder={t('Send message as simulated user...', '以模拟用户身份发送消息...')}
              />
              <button onClick={() => void handleSend()} disabled={sending || !input.trim()}>
                {sending ? t('Sending...', '发送中...') : t('Send', '发送')}
              </button>
            </div>
            {error && <p className={styles.error}>{error}</p>}
          </div>
        </section>

        <aside className={styles.rightPane}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h3>{t('Routing X-Ray', '路由决策透视镜')}</h3>
              <label className={styles.switch}>
                <input
                  type="checkbox"
                  checked={debugMode}
                  onChange={event => setDebugMode(event.target.checked)}
                />
                <span>{t('Debug Mode', '调试模式')}</span>
              </label>
            </div>
            <p className={styles.routeHint}>
              {t('Detected route:', '识别路由：')} <strong>{routeHint}</strong>
            </p>
            <div className={styles.routeList}>
              <div className={routeHint === 'memory_search' ? styles.routeActive : styles.routeItem}>
                {t('Answered via archival memory', '直接检索记忆后回答')}
              </div>
              <div className={routeHint === 'handoff_to' ? styles.routeActive : styles.routeItem}>
                {t('Handoff to specialist role', '交接给专家角色')}
              </div>
              <div className={routeHint === 'dispatch_subtasks' ? styles.routeActive : styles.routeItem}>
                {t('Dispatch parallel swarm subtasks', '并行派发子任务')}
              </div>
            </div>
            {debugMode && (
              <>
                <div className={styles.debugActions}>
                  <button
                    className={styles.copyButton}
                    onClick={() => void handleCopyDebugLog()}
                    disabled={eventLog.length === 0}
                  >
                    {copyState === 'success'
                      ? t('Copied', '已复制')
                      : copyState === 'error'
                        ? t('Copy Failed', '复制失败')
                        : t('Copy Log', '复制日志')}
                  </button>
                </div>
                <pre className={styles.eventLog}>{debugLogText}</pre>
              </>
            )}
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <h3>{t('Swarm Monitor', 'Swarm 运行看板')}</h3>
              {activeRunId && showSwarmMonitor ? (
                <a
                  className={styles.traceLink}
                  href={`/trace/${activeRunId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('Open Trace', '打开 Trace')}
                </a>
              ) : null}
            </div>
            {!activeRunId && (
              <p className={styles.placeholder}>
                {t('Send a request to inspect swarm execution details.', '发送一条请求后可查看 Swarm 执行细节。')}
              </p>
            )}
            {activeRunId && !showSwarmMonitor && (
              <p className={styles.placeholder}>
                {swarmApiUnsupported
                  ? t(
                      'Current backend does not support /swarm endpoint. Monitor is disabled.',
                      '当前后端不支持 /swarm 接口，运行看板已自动关闭。',
                    )
                  : t(
                      'Monitor will start when swarm delegation is triggered.',
                      '仅在触发 Swarm 委派后启动运行看板。',
                    )}
              </p>
            )}
            {activeRunId && showSwarmMonitor && (
              <>
                <div className={styles.swarmHeader}>
                  <span>
                    {t('Parent Run', '父 Run')}: <strong>{swarmSnapshot?.parent_run_id ?? activeRunId}</strong>
                  </span>
                  {swarmSnapshot && (
                    <span className={`${styles.swarmBadge} ${styles[`status_${swarmSnapshot.parent_status}`] ?? ''}`}>
                      {swarmSnapshot.parent_status}
                    </span>
                  )}
                </div>
                {swarmUpdatedAt && (
                  <p className={styles.swarmMeta}>
                    {t('Updated', '更新时间')}: {new Date(swarmUpdatedAt).toLocaleTimeString()}
                  </p>
                )}
                {swarmError && <p className={styles.error}>{swarmError}</p>}
                {approvalError && <p className={styles.error}>{approvalError}</p>}
                {swarmSnapshot && (
                  <>
                    <div className={styles.swarmStats}>
                      <div>
                        <strong>{swarmSnapshot.summary.total}</strong>
                        <span>{t('Subtasks', '子任务')}</span>
                      </div>
                      <div>
                        <strong>{swarmSnapshot.summary.pending}</strong>
                        <span>{t('Pending', '待完成')}</span>
                      </div>
                      <div>
                        <strong>{swarmSnapshot.summary.completed}</strong>
                        <span>{t('Completed', '已完成')}</span>
                      </div>
                      <div>
                        <strong>{swarmSnapshot.summary.failed}</strong>
                        <span>{t('Failed', '失败')}</span>
                      </div>
                    </div>
                    <div className={styles.progressTrack}>
                      <div
                        className={styles.progressFill}
                        style={{ width: `${swarmProgress}%` }}
                      />
                    </div>
                    {swarmSnapshot.summary.total === 0 ? (
                      <p className={styles.placeholder}>
                        {t('No subtasks dispatched yet.', '当前还没有分发子任务。')}
                      </p>
                    ) : (
                      <div className={styles.depList}>
                        {swarmSnapshot.dependencies.map(dep => (
                          <article key={dep.id} className={styles.depCard}>
                            <div className={styles.depTop}>
                              <code>{dep.role_id ?? dep.child_agent_id ?? 'unknown'}</code>
                              <span className={`${styles.swarmBadge} ${styles[`status_${dep.status}`] ?? ''}`}>
                                {dep.status}
                              </span>
                            </div>
                            <p>{dep.goal}</p>
                            <div className={styles.depMeta}>
                              <span>{t('child', '子 Run')}: {dep.child_run_id}</span>
                              <span>{t('tool', '工具调用')}: {dep.tool_call_id}</span>
                              <span>{t('child status', '子 Run 状态')}: {dep.child_status ?? 'unknown'}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                    {pendingApprovals.length > 0 && (
                      <div className={styles.approvalBlock}>
                        <h4>{t('Pending Approvals', '待审批工具调用')}</h4>
                        {pendingApprovals.map(item => {
                          const key = `${item.runId}:${item.toolCallId}`;
                          const busy = approvalBusyKey === key;
                          return (
                            <article key={key} className={styles.approvalItem}>
                              <div className={styles.approvalHead}>
                                <strong>{item.toolName}</strong>
                                <span className={`${styles.swarmBadge} ${styles[`status_suspended`]}`}>
                                  {item.riskLevel}
                                </span>
                              </div>
                              <p>{item.reason || t('No reason provided', '未提供原因')}</p>
                              <div className={styles.depMeta}>
                                <span>{t('run', '运行')}: {item.runId}</span>
                                <span>{t('tool_call', '工具调用 ID')}: {item.toolCallId}</span>
                              </div>
                              <pre className={styles.argsPreview}>
                                {JSON.stringify(item.args, null, 2)}
                              </pre>
                              <label className={styles.inlineField}>
                                <span>{t('Reject reason (optional)', '拒绝理由（可选）')}</span>
                                <input
                                  value={approvalReasonByKey[key] ?? ''}
                                  onChange={event => setApprovalReasonByKey(prev => ({
                                    ...prev,
                                    [key]: event.target.value,
                                  }))}
                                  placeholder={t('Why reject?', '为何拒绝？')}
                                />
                              </label>
                              <div className={styles.approvalActions}>
                                <button
                                  className={styles.rejectAction}
                                  onClick={() => void rejectPending(item)}
                                  disabled={busy}
                                >
                                  {t('Reject', '拒绝')}
                                </button>
                                <button
                                  className={styles.approveAction}
                                  onClick={() => void approvePending(item)}
                                  disabled={busy}
                                >
                                  {busy ? t('Processing...', '处理中...') : t('Approve', '同意')}
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </article>

          <article className={styles.panel}>
            <h3>{t('Episodic Memory Control', '情景记忆注入与控制')}</h3>
            <label>
              <span>{t('Fact', '记忆事实')}</span>
              <input
                value={memoryFact}
                onChange={event => setMemoryFact(event.target.value)}
                placeholder={t('User prefers concise tables only', '用户只喜欢表格化简洁回答')}
              />
            </label>
            <label>
              <span>{t('Weight', '权重')} {memoryWeight.toFixed(2)}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={memoryWeight}
                onChange={event => setMemoryWeight(Number.parseFloat(event.target.value))}
              />
            </label>
            <button className={styles.addButton} onClick={addMemory}>
              {t('Inject Memory', '注入记忆')}
            </button>
            <div className={styles.memoryList}>
              {injectedMemories.map(memory => (
                <div key={memory.id} className={styles.memoryItem}>
                  <strong>{memory.weight.toFixed(2)}</strong>
                  <span>{memory.fact}</span>
                </div>
              ))}
            </div>
          </article>
        </aside>
      </div>
    </AppShell>
  );
}
