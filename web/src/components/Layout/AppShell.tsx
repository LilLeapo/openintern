import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import styles from './AppShell.module.css';

interface AppShellProps {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}

interface NavItem {
  to: string;
  label: string;
  description: string;
}

const navItems: NavItem[] = [
  { to: '/', label: 'Chat', description: 'Conversation Workspace' },
  { to: '/runs', label: 'Runs', description: 'History & Operations' },
  { to: '/blackboard', label: 'Blackboard', description: 'Group Memory Board' },
  { to: '/orchestrator', label: 'Orchestrator', description: 'Roles · Groups · Group Runs' },
];

function isPathActive(pathname: string, navPath: string): boolean {
  if (navPath === '/') {
    return pathname === '/';
  }
  return pathname === navPath || pathname.startsWith(`${navPath}/`);
}

export function AppShell({ title, subtitle, actions, children }: AppShellProps) {
  const location = useLocation();
  const { sessionKey, setSessionKey } = useAppPreferences();
  const [draftSessionKey, setDraftSessionKey] = useState(sessionKey);

  useEffect(() => {
    setDraftSessionKey(sessionKey);
  }, [sessionKey]);

  const changed = draftSessionKey.trim() !== sessionKey;
  const applyDisabled = draftSessionKey.trim().length === 0 || !changed;

  const pageLabel = useMemo(() => {
    const activeItem = navItems.find(item => isPathActive(location.pathname, item.to));
    return activeItem?.label ?? 'Trace';
  }, [location.pathname]);

  return (
    <div className={styles.shell}>
      <div className={styles.backgroundShapeA} />
      <div className={styles.backgroundShapeB} />
      <aside className={styles.sidebar}>
        <div className={styles.brandBlock}>
          <p className={styles.brandEyebrow}>OpenIntern</p>
          <h1 className={styles.brandTitle}>Control Console</h1>
          <p className={styles.brandDescription}>
            Observe runs, debug traces, and evolve memory in one workspace.
          </p>
        </div>
        <nav className={styles.nav}>
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `${styles.navItem} ${
                  isActive || isPathActive(location.pathname, item.to)
                    ? styles.navItemActive
                    : ''
                }`
              }
            >
              <span className={styles.navLabel}>{item.label}</span>
              <span className={styles.navDescription}>{item.description}</span>
            </NavLink>
          ))}
        </nav>
        <div className={styles.sessionCard}>
          <p className={styles.sessionLabel}>Session Key</p>
          <div className={styles.sessionInputRow}>
            <input
              className={styles.sessionInput}
              value={draftSessionKey}
              onChange={e => setDraftSessionKey(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  setSessionKey(draftSessionKey);
                }
              }}
              aria-label="Session key"
            />
            <button
              className={styles.applyButton}
              onClick={() => setSessionKey(draftSessionKey)}
              disabled={applyDisabled}
            >
              Apply
            </button>
          </div>
          <p className={styles.sessionHint}>Current scope: {pageLabel}</p>
        </div>
      </aside>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <h2 className={styles.pageTitle}>{title}</h2>
            <p className={styles.pageSubtitle}>{subtitle}</p>
          </div>
          {actions && <div className={styles.headerActions}>{actions}</div>}
        </header>
        <section className={styles.content}>{children}</section>
      </main>
    </div>
  );
}
