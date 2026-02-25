import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/Layout/AppShell';
import { apiClient } from '../api/client';
import { useSSE } from '../hooks/useSSE';
import { useLocaleText } from '../i18n/useLocaleText';
import { useAppPreferences } from '../context/AppPreferencesContext';
import { recordRunScope } from '../utils/runScopeRegistry';
import type { Event } from '../types/events';
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

interface IdentityPreset {
  id: string;
  label: string;
  orgId: string;
  userId: string;
  projectId: string;
}

const PRESETS: IdentityPreset[] = [
  { id: 'boss_001', label: 'boss_001', orgId: 'org_board', userId: 'boss_001', projectId: 'finance' },
  { id: 'intern_002', label: 'intern_002', orgId: 'org_board', userId: 'intern_002', projectId: 'intern-lab' },
  { id: 'ops_007', label: 'ops_007', orgId: 'org_ops', userId: 'ops_007', projectId: 'incident-center' },
];

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

export function EmulatorPage() {
  const { t } = useLocaleText();
  const { tenantScope, setTenantScope } = useAppPreferences();
  const [identityId, setIdentityId] = useState(PRESETS[0]!.id);
  const [messages, setMessages] = useState<EmulatorMessage[]>([]);
  const [input, setInput] = useState('');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(true);
  const [eventLog, setEventLog] = useState<Event[]>([]);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [injectedMemories, setInjectedMemories] = useState<InjectedMemory[]>([]);
  const [memoryFact, setMemoryFact] = useState('');
  const [memoryWeight, setMemoryWeight] = useState(0.9);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asyncStatus, setAsyncStatus] = useState<'idle' | 'waiting' | 'resumed'>('idle');

  const { events } = useSSE(activeRunId);

  useEffect(() => {
    const preset = PRESETS.find(item => item.id === identityId);
    if (!preset) return;
    setTenantScope({
      orgId: preset.orgId,
      userId: preset.userId,
      projectId: preset.projectId,
    });
  }, [identityId, setTenantScope]);

  useEffect(() => {
    if (events.length === 0) return;
    const lastEvent = events[events.length - 1];
    if (!lastEvent) return;

    if (debugMode) {
      setEventLog(events);
    }

    if (lastEvent.type === 'llm.token') {
      const payload = lastEvent.payload as { token?: string };
      const token = payload.token ?? '';
      if (!streamingMessageId) {
        const id = genId('assistant_stream');
        setStreamingMessageId(id);
        setMessages(prev => [...prev, {
          id,
          role: 'assistant',
          content: token,
          ts: lastEvent.ts,
        }]);
      } else {
        setMessages(prev => prev.map(message => (
          message.id === streamingMessageId
            ? { ...message, content: `${message.content}${token}` }
            : message
        )));
      }
      return;
    }

    if (lastEvent.type === 'run.suspended' || lastEvent.type === 'tool.requires_approval') {
      setAsyncStatus('waiting');
      setMessages(prev => [...prev, {
        id: genId('status_wait'),
        role: 'system',
        content: t('PA is waiting for background swarm result...', 'PA 正在等待后台 Swarm 结果...'),
        ts: new Date().toISOString(),
      }]);
      return;
    }

    if (lastEvent.type === 'run.resumed') {
      setAsyncStatus('resumed');
      setMessages(prev => [...prev, {
        id: genId('status_resume'),
        role: 'system',
        content: t('PA resumed and is preparing final response.', 'PA 已恢复执行，正在准备最终回复。'),
        ts: new Date().toISOString(),
      }]);
      return;
    }

    if (lastEvent.type === 'run.completed') {
      const payload = lastEvent.payload as { output?: string };
      const output = payload.output ?? '';
      if (streamingMessageId) {
        setMessages(prev => prev.map(message => (
          message.id === streamingMessageId
            ? { ...message, content: output, ts: lastEvent.ts }
            : message
        )));
      } else {
        setMessages(prev => [...prev, {
          id: genId('assistant_final'),
          role: 'assistant',
          content: output,
          ts: lastEvent.ts,
        }]);
      }
      setStreamingMessageId(null);
      setSending(false);
      setAsyncStatus('idle');
      return;
    }

    if (lastEvent.type === 'run.failed') {
      const payload = lastEvent.payload as { error?: { message?: string } };
      setMessages(prev => [...prev, {
        id: genId('assistant_error'),
        role: 'assistant',
        content: `Error: ${payload.error?.message ?? 'run failed'}`,
        ts: lastEvent.ts,
      }]);
      setStreamingMessageId(null);
      setSending(false);
      setAsyncStatus('idle');
    }
  }, [debugMode, events, streamingMessageId, t]);

  const routeHint = useMemo(() => classifyRoute(eventLog), [eventLog]);

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

    const prompt = memoryContext
      ? `${text}\n\n[Injected Episodic Memory]\n${memoryContext}\nPlease respect these user preferences if possible.`
      : text;

    setMessages(prev => [...prev, {
      id: genId('user'),
      role: 'user',
      content: text,
      ts: new Date().toISOString(),
    }]);
    setInput('');
    setEventLog([]);
    setStreamingMessageId(null);

    try {
      const response = await apiClient.createRun(
        `s_emulator_${identityId}`,
        prompt,
      );
      recordRunScope(response.run_id, apiClient.getScope());
      setActiveRunId(response.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to send', '发送失败'));
      setSending(false);
    }
  }, [identityId, injectedMemories, input, sending, t]);

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
            <label>
              <span>{t('Identity', '身份')}</span>
              <select value={identityId} onChange={event => setIdentityId(event.target.value)}>
                {PRESETS.map(preset => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select>
            </label>
            <div className={styles.tenantChip}>
              <strong>{tenantScope.orgId}</strong>
              <span>{tenantScope.projectId ?? 'default'}</span>
              <em>{tenantScope.userId}</em>
            </div>
          </header>

          <div className={styles.chatFrame}>
            <div className={styles.chatHeader}>
              <h3>{t('IM Environment Simulator', 'IM 沉浸式模拟器')}</h3>
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
              <pre className={styles.eventLog}>
                {eventLog.length === 0
                  ? t('No events yet.', '暂无事件流。')
                  : eventLog.map(event => `[${event.type}] ${JSON.stringify(event.payload)}`).join('\n')}
              </pre>
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
