import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatWindow } from '../components/Chat';
import { PAProfile } from '../components/PA';
import { apiClient } from '../api/client';
import { useChat } from '../hooks/useChat';
import { useSSE } from '../hooks/useSSE';
import { AppShell } from '../components/Layout/AppShell';
import { useAppPreferences } from '../context/AppPreferencesContext';
import { useLocaleText } from '../i18n/useLocaleText';
import type { Group, Role } from '../types';
import type { Event } from '../types/events';
import styles from './ChatPage.module.css';

const QUICK_PROMPTS_EN = [
  'Help me summarize the latest failed run and propose a rollback plan.',
  'Analyze this requirement and split it into expert subtasks.',
  'Draft a release checklist and mark high-risk tools for approval.',
  'Generate a concise stakeholder update in table format.',
];

const QUICK_PROMPTS_ZH = [
  '请总结最近失败任务并给出回滚方案。',
  '请分析这个需求并拆分为专家子任务。',
  '请生成上线检查清单并标记高风险工具审批点。',
  '请用表格输出一段给干系人的进展同步。',
];

type ChatMode = 'pa' | 'role' | 'group';

function parseEventPreview(event: Event): string {
  const payload = JSON.stringify(event.payload);
  if (payload.length <= 90) {
    return payload;
  }
  return `${payload.slice(0, 90)}...`;
}

export function ChatPage() {
  const {
    sessionKey,
    sessionHistory,
    setSessionKey,
    createSession,
    removeSession,
    tenantScope,
    setTenantScope,
  } = useAppPreferences();
  const { isZh, t } = useLocaleText();
  const navigate = useNavigate();

  const {
    messages,
    isRunning,
    isWaiting,
    error,
    sendMessage,
    clearMessages,
    currentRunId,
    latestRunId,
    escalation,
    pendingApproval,
    approveToolCall,
    rejectToolCall,
  } = useChat(sessionKey);

  const [roles, setRoles] = useState<Role[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [mode, setMode] = useState<ChatMode>('pa');
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  const [orgIdDraft, setOrgIdDraft] = useState(tenantScope.orgId);
  const [userIdDraft, setUserIdDraft] = useState(tenantScope.userId);
  const [projectIdDraft, setProjectIdDraft] = useState(tenantScope.projectId ?? '');

  const debugRunId = currentRunId ?? latestRunId;
  const { events: debugEvents } = useSSE(debugMode ? debugRunId : null);

  useEffect(() => {
    const loadCatalog = async () => {
      setCatalogError(null);
      try {
        const [nextRoles, nextGroups] = await Promise.all([
          apiClient.listRoles(),
          apiClient.listGroups(tenantScope.projectId ?? undefined),
        ]);
        setRoles(nextRoles);
        setGroups(nextGroups);
        setSelectedRoleId(prev => prev || nextRoles[0]?.id || '');
        setSelectedGroupId(prev => (
          prev && nextGroups.some(group => group.id === prev)
            ? prev
            : (nextGroups[0]?.id || '')
        ));
      } catch (err) {
        setCatalogError(err instanceof Error ? err.message : t('Failed to load catalog', '加载目录失败'));
      }
    };
    void loadCatalog();
  }, [t, tenantScope.projectId]);

  useEffect(() => {
    setOrgIdDraft(tenantScope.orgId);
    setUserIdDraft(tenantScope.userId);
    setProjectIdDraft(tenantScope.projectId ?? '');
  }, [tenantScope.orgId, tenantScope.projectId, tenantScope.userId]);

  const stats = useMemo(() => {
    const assistantCount = messages.filter(msg => msg.role === 'assistant').length;
    const userCount = messages.length - assistantCount;
    const runCount = new Set(messages.map(msg => msg.runId).filter(Boolean)).size;
    return { assistantCount, userCount, runCount };
  }, [messages]);

  const quickPrompts = isZh ? QUICK_PROMPTS_ZH : QUICK_PROMPTS_EN;

  const modeLabel = useMemo(() => {
    if (mode === 'role') {
      const role = roles.find(item => item.id === selectedRoleId);
      return role ? `${t('Role', '角色')}: ${role.name}` : t('Role', '角色');
    }
    if (mode === 'group') {
      const group = groups.find(item => item.id === selectedGroupId);
      return group ? `${t('Group', '群组')}: ${group.name}` : t('Group', '群组');
    }
    return t('PA Default', 'PA 默认');
  }, [groups, mode, roles, selectedGroupId, selectedRoleId, t]);

  const handleSendPrompt = (prompt: string) => {
    void sendMessage(prompt, undefined, {
      mode,
      ...(mode === 'role' ? { roleId: selectedRoleId } : {}),
      ...(mode === 'group' ? { groupId: selectedGroupId } : {}),
    });
  };

  return (
    <AppShell
      title={t('Playground / Chat', 'Agent 游乐场 / 对话')}
      subtitle={t(
        `Session ${sessionKey} · ${modeLabel}`,
        `会话 ${sessionKey} · ${modeLabel}`,
      )}
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
              <span className={styles.statLabel}>{t('Runs', '运行数')}</span>
              <strong className={styles.statValue}>{stats.runCount}</strong>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>{t('Mode', '模式')}</span>
              <strong className={styles.statValue}>{mode.toUpperCase()}</strong>
            </div>
          </div>
          <ChatWindow
            messages={messages}
            onSend={(message, files) => sendMessage(message, files, {
              mode,
              ...(mode === 'role' ? { roleId: selectedRoleId } : {}),
              ...(mode === 'group' ? { groupId: selectedGroupId } : {}),
            })}
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
            pendingApproval={pendingApproval}
            onApprove={approveToolCall}
            onReject={rejectToolCall}
          />
        </section>

        <aside className={styles.sidePanel}>
          <PAProfile isRunning={isRunning} isWaiting={isWaiting} />

          <div className={styles.panelBlock}>
            <h3>{t('Target Runtime', '目标运行时')}</h3>
            {catalogError && <p className={styles.inlineError}>{catalogError}</p>}
            <div className={styles.segmented}>
              <button
                className={mode === 'pa' ? styles.segmentActive : styles.segment}
                onClick={() => setMode('pa')}
              >
                PA
              </button>
              <button
                className={mode === 'role' ? styles.segmentActive : styles.segment}
                onClick={() => setMode('role')}
              >
                Role
              </button>
              <button
                className={mode === 'group' ? styles.segmentActive : styles.segment}
                onClick={() => setMode('group')}
              >
                Group
              </button>
            </div>
            {mode === 'role' && (
              <label className={styles.field}>
                <span>{t('Role', '角色')}</span>
                <select
                  value={selectedRoleId}
                  onChange={event => setSelectedRoleId(event.target.value)}
                >
                  {roles.map(role => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              </label>
            )}
            {mode === 'group' && (
              <label className={styles.field}>
                <span>{t('Group', '群组')}</span>
                <select
                  value={selectedGroupId}
                  onChange={event => setSelectedGroupId(event.target.value)}
                >
                  {groups.map(group => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className={styles.panelBlock}>
            <h3>{t('Tenant Headers', '租户 Header')}</h3>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>org_id</span>
                <input value={orgIdDraft} onChange={event => setOrgIdDraft(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span>user_id</span>
                <input value={userIdDraft} onChange={event => setUserIdDraft(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span>project_id</span>
                <input value={projectIdDraft} onChange={event => setProjectIdDraft(event.target.value)} />
              </label>
            </div>
            <button
              className={styles.sessionActionPrimary}
              onClick={() => setTenantScope({
                orgId: orgIdDraft,
                userId: userIdDraft,
                projectId: projectIdDraft || null,
              })}
              disabled={isRunning}
            >
              {t('Apply Tenant', '应用租户变量')}
            </button>
          </div>

          <div className={styles.panelBlock}>
            <h3>{t('Conversations', '会话')}</h3>
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
            <h3>{t('Task Starters', '任务模板')}</h3>
            <div className={styles.promptList}>
              {quickPrompts.map(prompt => (
                <button
                  key={prompt}
                  className={styles.promptButton}
                  onClick={() => handleSendPrompt(prompt)}
                  disabled={isRunning}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.panelBlock}>
            <div className={styles.debugHeader}>
              <h3>{t('Debug Mode', '调试模式')}</h3>
              <label className={styles.debugToggle}>
                <input
                  type="checkbox"
                  checked={debugMode}
                  onChange={event => setDebugMode(event.target.checked)}
                />
                <span>{debugMode ? t('On', '开') : t('Off', '关')}</span>
              </label>
            </div>
            {debugMode && (
              <div className={styles.eventStream}>
                {debugRunId && <p className={styles.debugRunId}>{debugRunId}</p>}
                {debugEvents.length === 0 ? (
                  <p className={styles.debugPlaceholder}>{t('No live events', '暂无实时事件')}</p>
                ) : (
                  debugEvents.slice(-24).map(event => (
                    <div key={`${event.span_id}_${event.ts}`} className={styles.eventItem}>
                      <span className={styles.eventType}>{event.type}</span>
                      <code>{parseEventPreview(event)}</code>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
