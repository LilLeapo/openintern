import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatWindow } from '../components/Chat';
import { useChat } from '../hooks/useChat';
import { useRuns } from '../hooks/useRuns';
import { AppShell } from '../components/Layout/AppShell';
import { useAppPreferences } from '../context/AppPreferencesContext';
import styles from './ChatPage.module.css';

const QUICK_PROMPTS = [
  'Summarize what changed in today\'s run and list next actions.',
  'Propose a safer rollback plan for the failing workflow.',
  'Draft a test checklist for this feature before release.',
  'Generate a concise status update for stakeholders.',
];

export function ChatPage() {
  const { sessionKey, sessionHistory, setSessionKey, createSession, removeSession } =
    useAppPreferences();
  const navigate = useNavigate();
  const { messages, isRunning, error, sendMessage, clearMessages, latestRunId } =
    useChat(sessionKey);
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

  return (
    <AppShell
      title="Agent Chat Workspace"
      subtitle={`Live collaboration in ${sessionKey}`}
      actions={
        <button
          className={styles.pageAction}
          onClick={() => navigate('/runs')}
        >
          Open Runs
        </button>
      }
    >
      <div className={styles.layout}>
        <section className={styles.chatColumn}>
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>User Messages</span>
              <strong className={styles.statValue}>{stats.userCount}</strong>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Agent Replies</span>
              <strong className={styles.statValue}>{stats.assistantCount}</strong>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Referenced Runs</span>
              <strong className={styles.statValue}>{stats.runCount}</strong>
            </div>
          </div>
          <ChatWindow
            messages={messages}
            onSend={sendMessage}
            isRunning={isRunning}
            error={error}
            onClear={clearMessages}
            latestRunId={latestRunId}
            onOpenRun={() => {
              if (latestRunId) {
                navigate(`/trace/${latestRunId}`);
              }
            }}
          />
        </section>
        <aside className={styles.sidePanel}>
          <div className={styles.panelBlock}>
            <h3>Sessions</h3>
            <p>Switch between session scopes and keep separate run histories.</p>
            <div className={styles.sessionActions}>
              <button
                className={styles.sessionActionPrimary}
                onClick={() => {
                  createSession();
                }}
                disabled={isRunning}
              >
                New Session
              </button>
              <button
                className={styles.sessionActionSecondary}
                onClick={() => void refreshSessionRuns()}
              >
                Refresh History
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
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.panelBlock}>
            <h3>Quick Prompts</h3>
            <p>Kickstart common tasks without typing full instructions.</p>
            <div className={styles.promptList}>
              {QUICK_PROMPTS.map(prompt => (
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
            <h3>Recent Agent Output</h3>
            {latestAssistant ? (
              <p className={styles.outputPreview}>{latestAssistant}</p>
            ) : (
              <p className={styles.emptyText}>
                No assistant output yet. Send the first prompt to begin.
              </p>
            )}
          </div>
          <div className={styles.panelBlock}>
            <h3>Session Run History</h3>
            {runsLoading ? (
              <p className={styles.emptyText}>Loading run history...</p>
            ) : sessionRuns.length === 0 ? (
              <p className={styles.emptyText}>
                This session has no runs yet.
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
            <h3>Workflow Tips</h3>
            <ul className={styles.tipList}>
              <li>Use a stable session key to keep run history coherent.</li>
              <li>Open Runs for queued status and cancellation actions.</li>
              <li>Trace view includes event-level debugging and export.</li>
            </ul>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
