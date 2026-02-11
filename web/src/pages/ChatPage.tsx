import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChatWindow } from '../components/Chat';
import { useChat } from '../hooks/useChat';
import { useRuns } from '../hooks/useRuns';
import { AppShell } from '../components/Layout/AppShell';
import { useAppPreferences } from '../context/AppPreferencesContext';
import type { RunLLMConfig } from '../api/client';
import styles from './ChatPage.module.css';

const QUICK_PROMPTS = [
  'Summarize what changed in today\'s run and list next actions.',
  'Propose a safer rollback plan for the failing workflow.',
  'Draft a test checklist for this feature before release.',
  'Generate a concise status update for stakeholders.',
];

const PROVIDER_STORAGE_KEY = 'openintern.chat.provider';
const MODEL_STORAGE_KEY = 'openintern.chat.model';

const MODEL_OPTIONS: Record<'openai' | 'anthropic' | 'mock', string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini'],
  anthropic: ['MiniMax-M2.1', 'claude-sonnet-4-20250514'],
  mock: ['mock-model'],
};

function readStoredProvider(): 'openai' | 'anthropic' | 'mock' {
  if (typeof window === 'undefined') {
    return 'anthropic';
  }
  const value = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
  if (value === 'openai' || value === 'anthropic' || value === 'mock') {
    return value;
  }
  return 'anthropic';
}

function readStoredModel(provider: 'openai' | 'anthropic' | 'mock'): string {
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

export function ChatPage() {
  const { sessionKey, sessionHistory, setSessionKey, createSession, removeSession } =
    useAppPreferences();
  const navigate = useNavigate();
  const [provider, setProvider] = useState<'openai' | 'anthropic' | 'mock'>(readStoredProvider);
  const [model, setModel] = useState<string>(() => readStoredModel(readStoredProvider()));

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

  const llmConfig = useMemo<RunLLMConfig>(
    () => ({
      provider,
      model,
    }),
    [provider, model]
  );

  const { messages, isRunning, error, sendMessage, clearMessages, latestRunId } =
    useChat(sessionKey, llmConfig);
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
            <h3>Model</h3>
            <p>Choose provider and model per run. API credentials stay server-side.</p>
            <div className={styles.modelControls}>
              <label className={styles.modelField}>
                <span>Provider</span>
                <select
                  value={provider}
                  onChange={event => setProvider(event.target.value as 'openai' | 'anthropic' | 'mock')}
                  disabled={isRunning}
                >
                  <option value="anthropic">anthropic</option>
                  <option value="openai">openai</option>
                  <option value="mock">mock</option>
                </select>
              </label>
              <label className={styles.modelField}>
                <span>Model</span>
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
