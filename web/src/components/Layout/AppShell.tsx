import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './AppShell.module.css';

interface AppShellProps {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}

interface NavItem {
  to: string;
  labelEn: string;
  labelZh: string;
  descriptionEn: string;
  descriptionZh: string;
}

const navItems: NavItem[] = [
  {
    to: '/',
    labelEn: 'Assistant',
    labelZh: '助手',
    descriptionEn: 'Conversations & Replies',
    descriptionZh: '对话与回复',
  },
  {
    to: '/runs',
    labelEn: 'Tasks',
    labelZh: '任务',
    descriptionEn: 'History & Status',
    descriptionZh: '历史与状态',
  },
  {
    to: '/blackboard',
    labelEn: 'Team Notes',
    labelZh: '团队笔记',
    descriptionEn: 'Shared Decisions & Evidence',
    descriptionZh: '共享决策与证据',
  },
  {
    to: '/orchestrator',
    labelEn: 'Team Studio',
    labelZh: '团队工作台',
    descriptionEn: 'Build Experts & Teams',
    descriptionZh: '构建专家与团队',
  },
  {
    to: '/skills',
    labelEn: 'Skills',
    labelZh: '技能',
    descriptionEn: 'Capability Catalog',
    descriptionZh: '能力目录',
  },
];

function isPathActive(pathname: string, navPath: string): boolean {
  if (navPath === '/') {
    return pathname === '/';
  }
  return pathname === navPath || pathname.startsWith(`${navPath}/`);
}

export function AppShell({ title, subtitle, actions, children }: AppShellProps) {
  const location = useLocation();
  const { sessionKey, setSessionKey, locale, setLocale } = useAppPreferences();
  const { t } = useLocaleText();
  const [draftSessionKey, setDraftSessionKey] = useState(sessionKey);

  useEffect(() => {
    setDraftSessionKey(sessionKey);
  }, [sessionKey]);

  const changed = draftSessionKey.trim() !== sessionKey;
  const applyDisabled = draftSessionKey.trim().length === 0 || !changed;

  const pageLabel = useMemo(() => {
    const activeItem = navItems.find(item => isPathActive(location.pathname, item.to));
    if (!activeItem) {
      return t('Trace', '追踪');
    }
    return t(activeItem.labelEn, activeItem.labelZh);
  }, [location.pathname, t]);

  return (
    <div className={styles.shell}>
      <div className={styles.backgroundShapeA} />
      <div className={styles.backgroundShapeB} />
      <aside className={styles.sidebar}>
        <div className={styles.brandBlock}>
          <p className={styles.brandEyebrow}>OpenIntern</p>
          <h1 className={styles.brandTitle}>{t('Agent Workspace', '智能体工作区')}</h1>
          <p className={styles.brandDescription}>
            {t(
              'Run tasks with assistants, review outcomes, and improve team memory.',
              '用助手执行任务、查看结果并持续沉淀团队记忆。',
            )}
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
              <span className={styles.navLabel}>{t(item.labelEn, item.labelZh)}</span>
              <span className={styles.navDescription}>{t(item.descriptionEn, item.descriptionZh)}</span>
            </NavLink>
          ))}
        </nav>
        <div className={styles.sessionCard}>
          <p className={styles.sessionLabel}>{t('Conversation ID', '会话 ID')}</p>
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
              aria-label={t('Conversation ID', '会话 ID')}
            />
            <button
              className={styles.applyButton}
              onClick={() => setSessionKey(draftSessionKey)}
              disabled={applyDisabled}
            >
              {t('Switch', '切换')}
            </button>
          </div>
          <div className={styles.localeRow}>
            <span className={styles.localeLabel}>{t('Language', '语言')}</span>
            <select
              className={styles.localeSelect}
              value={locale}
              onChange={event => setLocale(event.target.value as 'en' | 'zh-CN')}
              aria-label={t('Language', '语言')}
            >
              <option value="en">English</option>
              <option value="zh-CN">中文</option>
            </select>
          </div>
          <p className={styles.sessionHint}>{t('Current page:', '当前页面：')} {pageLabel}</p>
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
