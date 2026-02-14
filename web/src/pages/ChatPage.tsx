import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatWindow } from '../components/Chat';
import { useChat } from '../hooks/useChat';
import { useRuns } from '../hooks/useRuns';
import { AppShell } from '../components/Layout/AppShell';
import { useAppPreferences } from '../context/AppPreferencesContext';
import { useLocaleText } from '../i18n/useLocaleText';
import type { RunLLMConfig } from '../api/client';
import { apiClient } from '../api/client';
import type { Group } from '../types';
import styles from './ChatPage.module.css';

const QUICK_PROMPTS_EN = [
  'Summarize what changed in today\'s run and list next actions.',
  'Propose a safer rollback plan for the failing workflow.',
  'Draft a test checklist for this feature before release.',
  'Generate a concise status update for stakeholders.',
];

const QUICK_PROMPTS_ZH = [
  '总结今天任务的变化，并列出下一步行动。',
  '为当前失败流程给出更安全的回滚方案。',
  '为这个功能上线前生成测试检查清单。',
  '生成一段简洁的项目进展同步给干系人。',
];

const PROVIDER_STORAGE_KEY = 'openintern.chat.provider';
const MODEL_STORAGE_KEY = 'openintern.chat.model';
const ASSISTANT_TARGET_STORAGE_KEY = 'openintern.chat.assistant_target';
const SOLO_ASSISTANT_TARGET = '__solo__';

const MODEL_OPTIONS: Record<'openai' | 'anthropic' | 'gemini' | 'mock', string[]> = {
  openai: ['gpt-5.2', 'gpt-4o', 'gpt-4o-mini'],
  anthropic: ['MiniMax-M2.1', 'claude-sonnet-4-20250514'],
  gemini: ['gemini-3-pro-preview', 'gemini-2.0-flash'],
  mock: ['mock-model'],
};

function readStoredProvider(): 'openai' | 'anthropic' | 'gemini' | 'mock' {
  if (typeof window === 'undefined') {
    return 'openai';
  }
  const value = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
  if (value === 'openai' || value === 'anthropic' || value === 'gemini' || value === 'mock') {
    return value;
  }
  return 'openai';
}

function readStoredModel(provider: 'openai' | 'anthropic' | 'gemini' | 'mock'): string {
  if (typeof window === 'undefined') {
    return MODEL_OPTIONS[provider][0]!;
  }
  const value = window.localStorage.getItem(MODEL_STORAGE_KEY);
  const options = MODEL_OPTIONS[provider];
  if (value && options.includes(value)) {
    return value;
  }
  return options[0]!;
}

function readStoredAssistantTarget(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const value = window.localStorage.getItem(ASSISTANT_TARGET_STORAGE_KEY);
  if (!value) {
    return null;
  }
  return value;
}

export function ChatPage() {
  const {
    sessionKey,
    sessionHistory,
    setSessionKey,
    createSession,
    removeSession,
    selectedGroupId,
    setSelectedGroupId,
  } =
    useAppPreferences();
  const { isZh, t } = useLocaleText();
  const navigate = useNavigate();
  const [provider, setProvider] = useState<'openai' | 'anthropic' | 'gemini' | 'mock'>(readStoredProvider);
  const [model, setModel] = useState<string>(() => readStoredModel(readStoredProvider()));
  const [assistantTarget, setAssistantTarget] = useState<string>(
    () => readStoredAssistantTarget() ?? SOLO_ASSISTANT_TARGET,
  );
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  useEffect(() => {
    const options = MODEL_OPTIONS[provider];
    if (!options.includes(model)) {
      setModel(options[0]!);
    }
  }, [provider, model]);

  useEffect(() => {
    window.localStorage.setItem(PROVIDER_STORAGE_KEY, provider);
  }, [provider]);

  useEffect(() => {
    window.localStorage.setItem(MODEL_STORAGE_KEY, model);
  }, [model]);

  useEffect(() => {
    window.localStorage.setItem(ASSISTANT_TARGET_STORAGE_KEY, assistantTarget);
  }, [assistantTarget]);

  useEffect(() => {
    let cancelled = false;
    const loadGroups = async () => {
      setGroupsLoading(true);
      try {
        const result = await apiClient.listGroups();
        if (cancelled) return;
        setGroups(result);
        if (result.length === 0) {
          setAssistantTarget(SOLO_ASSISTANT_TARGET);
          return;
        }
        if (!selectedGroupId) {
          setSelectedGroupId(result[0]!.id);
        }
        setAssistantTarget(prev => {
          if (prev === SOLO_ASSISTANT_TARGET) {
            return prev;
          }
          return result.some(group => group.id === prev) ? prev : result[0]!.id;
        });
      } finally {
        if (!cancelled) {
          setGroupsLoading(false);
        }
      }
    };
    void loadGroups();
    return () => {
      cancelled = true;
    };
  }, [selectedGroupId, setSelectedGroupId]);

  useEffect(() => {
    if (assistantTarget === SOLO_ASSISTANT_TARGET) {
      return;
    }
    if (selectedGroupId !== assistantTarget) {
      setSelectedGroupId(assistantTarget);
    }
  }, [assistantTarget, selectedGroupId, setSelectedGroupId]);

  const runMode: 'single' | 'group' =
    assistantTarget === SOLO_ASSISTANT_TARGET ? 'single' : 'group';
  const activeGroupId = runMode === 'group' ? assistantTarget : null;
  const activeTeam = groups.find(group => group.id === activeGroupId) ?? null;

  const llmConfig = useMemo<RunLLMConfig>(
    () => ({
      provider,
      model,
    }),
    [provider, model]
  );

  const { messages, isRunning, isWaiting, error, sendMessage, clearMessages, latestRunId, escalation } =
    useChat(sessionKey, {
      llmConfig,
      runMode,
      groupId: activeGroupId,
    });
  const {
    runs: sessionRuns,
    loading: runsLoading,
    refresh: refreshSessionRuns,
  } = useRuns(sessionKey, 8);

  const stats = useMemo(() => {
    const assistantCount = messages.filter(msg => msg.role === 'assistant').length;
    const userCount = messages.length - assistantCount;
    const runCount = new Set(messages.map(msg => msg.runId).filter(Boolean)).size;
    return { assistantCount, userCount, runCount };
  }, [messages]);

  const latestAssistant = useMemo(
    () =>
      [...messages]
        .reverse()
        .find(message => message.role === 'assistant')?.content,
    [messages],
  );

  const quickPrompts = isZh ? QUICK_PROMPTS_ZH : QUICK_PROMPTS_EN;

  return (
    <AppShell
      title={t('Assistant Workspace', '助手工作区')}
      subtitle={
        runMode === 'group' && activeTeam
          ? t(
              `Team mode: ${activeTeam.name} · Conversation ${sessionKey}`,
              `团队模式：${activeTeam.name} · 会话 ${sessionKey}`,
            )
          : t(
              `Personal assistant mode · Conversation ${sessionKey}`,
              `个人助手模式 · 会话 ${sessionKey}`,
            )
      }
      actions={
        <button
          className={styles.pageAction}
          onClick={() => navigate('/runs')}
        >
          {t('Open Task Center', '打开任务中心')}
        </button>
      }
    >
      <div className={styles.layout}>
        <section className={styles.chatColumn}>
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>{t('Your Messages', '你的消息')}</span>
              <strong className={styles.statValue}>{stats.userCount}</strong>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>{t('Assistant Replies', '助手回复')}</span>
              <strong className={styles.statValue}>{stats.assistantCount}</strong>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>{t('Completed Tasks', '已完成任务')}</span>
              <strong className={styles.statValue}>{stats.runCount}</strong>
            </div>
          </div>
          <ChatWindow
            messages={messages}
            onSend={sendMessage}
            isRunning={isRunning}
            isWaiting={isWaiting}
            error={error}
            onClear={clearMessages}
            latestRunId={latestRunId}
            escalationChildRunId={escalation?.childRunId ?? null}
            onViewGroupDiscussion={
              escalation?.childRunId
                ? () => navigate(`/group-run/${escalation.childRunId}`)
                : undefined
            }
            onOpenRun={() => {
              if (latestRunId) {
                navigate(`/trace/${latestRunId}`);
              }
            }}
          />
        </section>
        <aside className={styles.sidePanel}>
          <div className={styles.panelBlock}>
            <h3>{t('Conversations', '会话')}</h3>
            <p>{t(
              'Keep different topics separated. Each conversation has its own context and task history.',
              '将不同主题分开管理。每个会话拥有独立上下文与任务历史。',
            )}</p>
            <div className={styles.sessionActions}>
              <button
                className={styles.sessionActionPrimary}
                onClick={() => {
                  createSession();
                }}
                disabled={isRunning}
              >
                {t('New Conversation', '新建会话')}
              </button>
              <button
                className={styles.sessionActionSecondary}
                onClick={() => void refreshSessionRuns()}
              >
                {t('Refresh Tasks', '刷新任务')}
              </button>
            </div>
            <div className={styles.sessionList}>
              {sessionHistory.map(item => (
                <div
                  key={item}
                  className={`${styles.sessionItem} ${
                    item === sessionKey ? styles.sessionItemActive : ''
                  }`}
                >
                  <button
                    className={styles.sessionSwitchButton}
                    onClick={() => setSessionKey(item)}
                    disabled={item === sessionKey}
                  >
                    {item}
                  </button>
                  <button
                    className={styles.sessionRemoveButton}
                    onClick={() => removeSession(item)}
                    disabled={sessionHistory.length <= 1 || item === sessionKey}
                    aria-label={`Remove ${item}`}
                  >
                    {t('Delete', '删除')}
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.panelBlock}>
            <h3>{t('Assistant', '助手')}</h3>
            <p>{t('Choose who should handle this conversation.', '选择谁来处理这个会话。')}</p>
            <div className={styles.modeControls}>
              <label className={styles.modeField}>
                <span>{t('Assistant', '助手')}</span>
                <select
                  value={assistantTarget}
                  onChange={event => setAssistantTarget(event.target.value)}
                  disabled={isRunning || groupsLoading}
                >
                  <option value={SOLO_ASSISTANT_TARGET}>{t('Personal Assistant', '个人助手')}</option>
                  {groups.map(group => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {runMode === 'group' && activeTeam && (
              <p className={styles.infoText}>
                {t(
                  'Team mode is active. You will receive one final response synthesized by the team lead.',
                  '当前为团队模式。你将收到由团队负责人综合后的最终回复。',
                )}
              </p>
            )}
            {groups.length === 0 && (
              <p className={styles.infoText}>
                {t(
                  'No assistant teams configured yet. Build one in Team Studio if you want multi-expert collaboration.',
                  '还没有配置助手团队。如需多专家协作，请先在团队工作台创建。',
                )}
                {' '}
                <button
                  className={styles.inlineLink}
                  onClick={() => navigate('/orchestrator')}
                  disabled={isRunning}
                >
                  {t('Open Team Studio', '打开团队工作台')}
                </button>
              </p>
            )}
          </div>
          <div className={styles.panelBlock}>
            <h3>{t('Model Routing (Advanced)', '模型路由（高级）')}</h3>
            <p>{t(
              'Choose provider and model for new tasks. API credentials stay server-side.',
              '为新任务选择 provider 和模型。API 凭据仅保存在服务端。',
            )}</p>
            <div className={styles.modelControls}>
              <label className={styles.modelField}>
                <span>{t('Provider', 'Provider')}</span>
                <select
                  value={provider}
                  onChange={event => setProvider(event.target.value as 'openai' | 'anthropic' | 'gemini' | 'mock')}
                  disabled={isRunning}
                >
                  <option value="anthropic">anthropic</option>
                  <option value="gemini">gemini</option>
                  <option value="openai">openai</option>
                  <option value="mock">mock</option>
                </select>
              </label>
              <label className={styles.modelField}>
                <span>{t('Model', '模型')}</span>
                <select
                  value={model}
                  onChange={event => setModel(event.target.value)}
                  disabled={isRunning}
                >
                  {MODEL_OPTIONS[provider].map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className={styles.panelBlock}>
            <h3>{t('Task Starters', '任务模板')}</h3>
            <p>{t('Kick off common tasks quickly.', '快速发起常见任务。')}</p>
            <div className={styles.promptList}>
              {quickPrompts.map(prompt => (
                <button
                  key={prompt}
                  className={styles.promptButton}
                  onClick={() => void sendMessage(prompt)}
                  disabled={isRunning}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.panelBlock}>
            <h3>{t('Recent Reply', '最近回复')}</h3>
            {latestAssistant ? (
              <p className={styles.outputPreview}>{latestAssistant}</p>
            ) : (
              <p className={styles.emptyText}>
                {t('No reply yet. Send your first request to start.', '还没有回复，发送第一条请求开始。')}
              </p>
            )}
          </div>
          <div className={styles.panelBlock}>
            <h3>{t('Conversation Tasks', '会话任务')}</h3>
            {runsLoading ? (
              <p className={styles.emptyText}>{t('Loading task history...', '正在加载任务历史...')}</p>
            ) : sessionRuns.length === 0 ? (
              <p className={styles.emptyText}>
                {t('No tasks in this conversation yet.', '当前会话还没有任务。')}
              </p>
            ) : (
              <div className={styles.runHistoryList}>
                {sessionRuns.map(run => (
                  <button
                    key={run.run_id}
                    className={styles.runHistoryItem}
                    onClick={() => navigate(`/trace/${run.run_id}`)}
                  >
                    <span className={styles.runHistoryId}>{run.run_id}</span>
                    <span className={styles.runHistoryMeta}>
                      {run.status} · {new Date(run.started_at).toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={styles.panelBlock}>
            <h3>{t('Usage Tips', '使用建议')}</h3>
            <ul className={styles.tipList}>
              <li>{t('Use one conversation per topic for cleaner context.', '建议每个主题单独一个会话，便于上下文管理。')}</li>
              <li>{t('Use team mode for multi-step analysis and review tasks.', '复杂分析或评审任务建议使用团队模式。')}</li>
              <li>{t('Open Task Center for queue status and cancellation.', '在任务中心查看排队状态和取消任务。')}</li>
            </ul>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
