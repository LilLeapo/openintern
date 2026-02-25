import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAppPreferences } from '../../context/AppPreferencesContext';
import { useLocaleText } from '../../i18n/useLocaleText';
import { apiClient } from '../../api/client';
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
    labelEn: 'Playground',
    labelZh: '游乐场',
    descriptionEn: 'Debug chat with tenant headers',
    descriptionZh: '带租户头的调试对话',
  },
  {
    to: '/emulator',
    labelEn: 'PA Emulator',
    labelZh: 'PA 模拟器',
    descriptionEn: 'IM simulation and routing x-ray',
    descriptionZh: 'IM 模拟与路由透视',
  },
  {
    to: '/dashboard',
    labelEn: 'Dashboard',
    labelZh: '监控大盘',
    descriptionEn: 'Runtime health and alerts',
    descriptionZh: 'Runtime 健康与告警',
  },
  {
    to: '/runs',
    labelEn: 'Runs',
    labelZh: '运行列表',
    descriptionEn: 'Filters, status, and queue ops',
    descriptionZh: '筛选状态与队列操作',
  },
  {
    to: '/inbox',
    labelEn: 'Approvals',
    labelZh: '审批中心',
    descriptionEn: 'Human-in-the-loop inbox',
    descriptionZh: '人工审批待办',
  },
];

const adminNavItems: NavItem[] = [
  {
    to: '/orchestrator',
    labelEn: 'Swarm Studio',
    labelZh: '编排中心',
    descriptionEn: 'Role and group orchestration',
    descriptionZh: 'Role 与 Group 编排',
  },
  {
    to: '/skills',
    labelEn: 'Plugin Registry',
    labelZh: '插件注册表',
    descriptionEn: 'Skills, schemas, and toggles',
    descriptionZh: '技能、Schema 与开关',
  },
  {
    to: '/blackboard',
    labelEn: 'Blackboard',
    labelZh: '黑板记忆',
    descriptionEn: 'Three-tier memory control',
    descriptionZh: '三层记忆透视与控制',
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
  const { locale, setLocale, tenantScope } = useAppPreferences();
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

  useEffect(() => {
    apiClient.setScope(tenantScope);
  }, [tenantScope]);

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
