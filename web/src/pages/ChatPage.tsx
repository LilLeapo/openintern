import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatWindow } from '../components/Chat';
import { PAProfile } from '../components/PA';
import { useChat } from '../hooks/useChat';
import { AppShell } from '../components/Layout/AppShell';
import { useAppPreferences } from '../context/AppPreferencesContext';
import { useLocaleText } from '../i18n/useLocaleText';
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

export function ChatPage() {
  const {
    sessionKey,
    sessionHistory,
    setSessionKey,
    createSession,
    removeSession,
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
    latestRunId,
    escalation,
    pendingApproval,
    approveToolCall,
    rejectToolCall,
  } = useChat(sessionKey);

  const stats = useMemo(() => {
    const assistantCount = messages.filter(msg => msg.role === 'assistant').length;
    const userCount = messages.length - assistantCount;
    const runCount = new Set(messages.map(msg => msg.runId).filter(Boolean)).size;
    return { assistantCount, userCount, runCount };
  }, [messages]);

  const quickPrompts = isZh ? QUICK_PROMPTS_ZH : QUICK_PROMPTS_EN;

  return (
    <AppShell
      title={t('Chat', '对话')}
      subtitle={t(
        `Conversation ${sessionKey}`,
        `会话 ${sessionKey}`,
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
            pendingApproval={pendingApproval}
            onApprove={approveToolCall}
            onReject={rejectToolCall}
          />
        </section>
        <aside className={styles.sidePanel}>
          <PAProfile isRunning={isRunning} isWaiting={isWaiting} />
          <div className={styles.panelBlock}>
            <h3>{t('Conversations', '会话')}</h3>
            <p>{t(
              'Keep different topics separated. Each conversation has its own context.',
              '将不同主题分开管理。每个会话拥有独立上下文。',
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
        </aside>
      </div>
    </AppShell>
  );
}
