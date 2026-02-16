import { useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './AppShell.module.css';

export interface AppShellProps {
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

const userNavItems: NavItem[] = [
  {
    to: '/',
    labelEn: 'Chat',
    labelZh: '对话',
    descriptionEn: 'Talk to your PA',
    descriptionZh: '和你的助理对话',
  },
  {
    to: '/runs',
    labelEn: 'History',
    labelZh: '历史',
    descriptionEn: 'Past tasks & traces',
    descriptionZh: '历史任务与追踪',
  },
];

const adminNavItems: NavItem[] = [
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
  {
    to: '/blackboard',
    labelEn: 'Team Notes',
    labelZh: '团队笔记',
    descriptionEn: 'Shared Decisions & Evidence',
    descriptionZh: '共享决策与证据',
  },
];

const allNavItems = [...userNavItems, ...adminNavItems];

function isPathActive(pathname: string, navPath: string): boolean {
  if (navPath === '/') {
    return pathname === '/';
  }
  return pathname === navPath || pathname.startsWith(`${navPath}/`);
}

export function AppShell({ title, subtitle, actions, children }: AppShellProps) {
  const location = useLocation();
  const { locale, setLocale } = useAppPreferences();
  const { t } = useLocaleText();
  const [adminOpen, setAdminOpen] = useState(() =>
    adminNavItems.some(item => isPathActive(location.pathname, item.to)),
  );

  const pageLabel = useMemo(() => {
    const activeItem = allNavItems.find(item => isPathActive(location.pathname, item.to));
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
              'Your personal assistant handles tasks and coordinates expert teams when needed.',
              '你的个人助理处理任务，必要时自动协调专家团队。',
            )}
          </p>
        </div>
        <nav className={styles.nav}>
          {userNavItems.map(item => (
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
          <button
            className={`${styles.navItem} ${styles.adminToggle} ${adminOpen ? styles.adminToggleOpen : ''}`}
            onClick={() => setAdminOpen(prev => !prev)}
            aria-expanded={adminOpen}
          >
            <span className={styles.navLabel}>{t('Admin', '管理')}</span>
            <span className={styles.navDescription}>
              {adminOpen
                ? t('Hide management tools', '收起管理工具')
                : t('Team, skills & notes', '团队、技能与笔记')}
            </span>
          </button>
          {adminOpen && adminNavItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `${styles.navItem} ${styles.adminItem} ${
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
