import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient, type FeishuConnector, type FeishuSyncJob } from '../api/client';
import { useBlackboard } from '../hooks/useBlackboard';
import { useSSE } from '../hooks/useSSE';
import { AppShell } from '../components/Layout/AppShell';
import { useAppPreferences } from '../context/AppPreferencesContext';
import { useLocaleText } from '../i18n/useLocaleText';
import type { Group, Role, EpisodicType, BlackboardMemory } from '../types';
import type { Event } from '../types/events';
import styles from './BlackboardPage.module.css';

interface RetrievalResult {
  memory: BlackboardMemory;
  score: number;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/)
      .filter(item => item.length > 1),
  );
}

function similarity(query: string, text: string): number {
  const q = tokenize(query);
  const t = tokenize(text);
  if (q.size === 0 || t.size === 0) return 0;
  let hit = 0;
  q.forEach((token) => {
    if (t.has(token)) hit += 1;
  });
  return hit / Math.sqrt(q.size * t.size);
}

export function BlackboardPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { sessionKey } = useAppPreferences();
  const { t } = useLocaleText();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [localGroupId, setLocalGroupId] = useState<string | null>(groupId ?? null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [memoryType, setMemoryType] = useState<EpisodicType>('DECISION');
  const [text, setText] = useState('');
  const [rationale, setRationale] = useState('');
  const [importance, setImportance] = useState(0.75);
  const [roleId, setRoleId] = useState('');
  const [liveRunId, setLiveRunId] = useState('');
  const [retrievalQuery, setRetrievalQuery] = useState('');
  const [retrievalResults, setRetrievalResults] = useState<RetrievalResult[]>([]);
  const [connectors, setConnectors] = useState<FeishuConnector[]>([]);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [lastSyncJob, setLastSyncJob] = useState<FeishuSyncJob | null>(null);

  const activeGroupId = useMemo(() => {
    if (groupId) return groupId;
    if (localGroupId) return localGroupId;
    return groups[0]?.id ?? null;
  }, [groupId, localGroupId, groups]);

  const { memories, decisions, evidence, todos, refresh } = useBlackboard(activeGroupId);
  const { events: liveEvents } = useSSE(liveRunId.trim() || null);

  useEffect(() => {
    const loadCatalog = async () => {
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        const [groupData, roleData] = await Promise.all([
          apiClient.listGroups(),
          apiClient.listRoles(),
        ]);
        setGroups(groupData);
        setRoles(roleData);
        setRoleId(prev => prev || roleData[0]?.id || '');
      } catch (err) {
        setCatalogError(err instanceof Error ? err.message : t('Failed to load catalog', '加载目录失败'));
      } finally {
        setCatalogLoading(false);
      }
    };
    void loadCatalog();
  }, [t]);

  useEffect(() => {
    const loadConnectors = async () => {
      try {
        const data = await apiClient.listFeishuConnectors();
        setConnectors(data);
      } catch {
        setConnectors([]);
      }
    };
    void loadConnectors();
  }, []);

  useEffect(() => {
    if (!activeGroupId) return;
    if (groupId === activeGroupId) return;
    navigate(`/blackboard/${activeGroupId}`, { replace: true });
  }, [activeGroupId, groupId, navigate]);

  useEffect(() => {
    void refresh();
  }, [refresh, liveEvents.length]);

  const liveKanban = useMemo(() => {
    const liveDecision: string[] = [];
    const liveEvidence: string[] = [];
    const liveTodo: string[] = [];

    liveEvents.forEach((event: Event) => {
      if (event.type === 'message.decision') {
        const payload = event.payload as { decision?: string; rationale?: string };
        liveDecision.push([payload.decision ?? '', payload.rationale ?? ''].filter(Boolean).join(' | '));
      }
      if (event.type === 'message.evidence') {
        const payload = event.payload as { summary?: string };
        liveEvidence.push(payload.summary ?? JSON.stringify(payload));
      }
      if (event.type === 'message.task') {
        const payload = event.payload as { goal?: string };
        liveTodo.push(payload.goal ?? JSON.stringify(payload));
      }
      if (event.type === 'tool.called') {
        const payload = event.payload as { toolName?: string; args?: Record<string, unknown> };
        if (payload.toolName === 'update_task_board') {
          liveTodo.push(JSON.stringify(payload.args ?? {}));
        }
        if (payload.toolName === 'write_evidence') {
          liveEvidence.push(JSON.stringify(payload.args ?? {}));
        }
      }
    });

    return { liveDecision, liveEvidence, liveTodo };
  }, [liveEvents]);

  const handleWrite = async (): Promise<void> => {
    if (!activeGroupId || !roleId || !text.trim()) {
      setSubmitError(t('Team, author, and content are required.', '团队、作者和内容为必填项。'));
      return;
    }

    const trimmedText = text.trim();
    const payloadText = (() => {
      if (memoryType === 'DECISION') {
        const rationaleLine = rationale.trim() ? `\nRationale: ${rationale.trim()}` : '';
        return `DECISION: ${trimmedText}${rationaleLine}`;
      }
      if (memoryType === 'EVIDENCE') {
        return `EVIDENCE: ${trimmedText}`;
      }
      return `TODO: ${trimmedText}`;
    })();

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await apiClient.writeBlackboard(activeGroupId, {
        type: 'episodic',
        text: payloadText,
        role_id: roleId,
        importance,
        metadata: {
          episodic_type: memoryType,
          session_key: sessionKey,
        },
      });
      setText('');
      setRationale('');
      await refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('Failed to save note', '保存笔记失败'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const runRetrieval = () => {
    const query = retrievalQuery.trim();
    if (!query) {
      setRetrievalResults([]);
      return;
    }
    const results = memories
      .map(memory => ({
        memory,
        score: similarity(query, memory.text),
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    setRetrievalResults(results);
  };

  const triggerConnectorSync = async (connectorId: string) => {
    setSyncStatus(t('Triggering ingestion...', '正在触发摄入...'));
    try {
      const job = await apiClient.triggerFeishuConnectorSync(connectorId, false);
      setLastSyncJob(job);
      setSyncStatus(t(`Sync job queued: ${job.id}`, `同步任务已排队：${job.id}`));
    } catch (err) {
      setSyncStatus(err instanceof Error ? err.message : t('Failed to sync connector', '触发同步失败'));
    }
  };

  return (
    <AppShell
      title={t('Blackboard & Memory', '黑板与知识库')}
      subtitle={t(
        'Three-tier memory overview, live kanban, and retrieval testing',
        '三层记忆透视、实时看板与检索测试',
      )}
      actions={
        <button
          className={styles.pageAction}
          onClick={() => void refresh()}
        >
          {t('Refresh', '刷新')}
        </button>
      }
    >
      <div className={styles.layout}>
        <section className={styles.formCard}>
          <h3>{t('Write Blackboard Memory', '写入群组黑板')}</h3>
          {catalogError && <p className={styles.errorText}>{catalogError}</p>}
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>{t('Group', '群组')}</span>
              <select
                value={activeGroupId ?? ''}
                onChange={e => {
                  const nextId = e.target.value;
                  setLocalGroupId(nextId || null);
                  if (nextId) navigate(`/blackboard/${nextId}`);
                }}
                disabled={catalogLoading}
              >
                {groups.map(group => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>{t('Role', '角色')}</span>
              <select
                value={roleId}
                onChange={e => setRoleId(e.target.value)}
                disabled={catalogLoading}
              >
                {roles.map(role => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>{t('Type', '类型')}</span>
              <select
                value={memoryType}
                onChange={e => setMemoryType(e.target.value as EpisodicType)}
              >
                <option value="DECISION">{t('Decision', '决策')}</option>
                <option value="EVIDENCE">{t('Evidence', '证据')}</option>
                <option value="TODO">{t('Action', '行动项')}</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>{t(`Importance (${importance.toFixed(2)})`, `重要性（${importance.toFixed(2)}）`)}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={importance}
                onChange={e => setImportance(Number.parseFloat(e.target.value))}
              />
            </label>
          </div>
          <label className={styles.field}>
            <span>{t('Content', '内容')}</span>
            <textarea className={styles.textarea} value={text} onChange={e => setText(e.target.value)} />
          </label>
          {memoryType === 'DECISION' && (
            <label className={styles.field}>
              <span>{t('Rationale', '依据')}</span>
              <input value={rationale} onChange={e => setRationale(e.target.value)} />
            </label>
          )}
          {submitError && <p className={styles.errorText}>{submitError}</p>}
          <button className={styles.submitButton} onClick={() => void handleWrite()} disabled={isSubmitting}>
            {isSubmitting ? t('Saving...', '保存中...') : t('Save Memory', '保存记忆')}
          </button>

          <div className={styles.liveCard}>
            <h4>{t('SSE Live Kanban Feed', 'SSE 实时看板流')}</h4>
            <label className={styles.field}>
              <span>{t('Live run_id', '监听 run_id')}</span>
              <input
                value={liveRunId}
                onChange={e => setLiveRunId(e.target.value)}
                placeholder="run_xxx"
              />
            </label>
          </div>
        </section>

        <section className={styles.mainPanel}>
          <article className={styles.kanbanPanel}>
            <h3>{t('Group Blackboard Kanban', '群组黑板看板')}</h3>
            <div className={styles.kanbanGrid}>
              <div className={styles.column}>
                <h4>{t('Decisions', '决策')}</h4>
                {[...decisions.map(item => item.text), ...liveKanban.liveDecision].map((item, idx) => (
                  <div key={`dec_${idx}`} className={styles.card}>{item}</div>
                ))}
              </div>
              <div className={styles.column}>
                <h4>{t('Evidence', '证据')}</h4>
                {[...evidence.map(item => item.text), ...liveKanban.liveEvidence].map((item, idx) => (
                  <div key={`ev_${idx}`} className={styles.card}>{item}</div>
                ))}
              </div>
              <div className={styles.column}>
                <h4>{t('TODO', '待办')}</h4>
                {[...todos.map(item => item.text), ...liveKanban.liveTodo].map((item, idx) => (
                  <div key={`todo_${idx}`} className={styles.card}>{item}</div>
                ))}
              </div>
            </div>
          </article>

          <article className={styles.labPanel}>
            <h3>{t('Archival Memory Retrieval Lab', '全局记忆池检索测试台')}</h3>
            <div className={styles.searchRow}>
              <input
                value={retrievalQuery}
                onChange={e => setRetrievalQuery(e.target.value)}
                placeholder={t('Input text to test recall', '输入文本测试召回效果')}
              />
              <button onClick={runRetrieval}>{t('Search', '检索')}</button>
            </div>
            <div className={styles.resultList}>
              {retrievalResults.map(item => (
                <article key={item.memory.id} className={styles.resultCard}>
                  <header>
                    <strong>{item.memory.id}</strong>
                    <span>{item.score.toFixed(3)}</span>
                  </header>
                  <p>{item.memory.text}</p>
                </article>
              ))}
              {retrievalResults.length === 0 && (
                <p className={styles.placeholder}>{t('No retrieval results yet.', '暂无检索结果。')}</p>
              )}
            </div>
          </article>

          <article className={styles.labPanel}>
            <h3>{t('Plugin Ingestion Trigger', 'Plugin 摄入触发')}</h3>
            <div className={styles.connectorList}>
              {connectors.map(connector => (
                <div key={connector.id} className={styles.connectorItem}>
                  <div>
                    <strong>{connector.name}</strong>
                    <p>{connector.id}</p>
                  </div>
                  <button onClick={() => void triggerConnectorSync(connector.id)}>
                    {t('Sync Now', '立即同步')}
                  </button>
                </div>
              ))}
              {connectors.length === 0 && (
                <p className={styles.placeholder}>
                  {t('No connector found for current project.', '当前项目没有可用连接器。')}
                </p>
              )}
            </div>
            {syncStatus && <p className={styles.syncStatus}>{syncStatus}</p>}
            {lastSyncJob && (
              <p className={styles.syncStatus}>
                {t('Last job', '最近任务')} {lastSyncJob.id} · {lastSyncJob.status}
              </p>
            )}
          </article>
        </section>
      </div>
    </AppShell>
  );
}
