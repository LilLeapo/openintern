import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const SESSION_STORAGE_KEY = 'openintern.session_key';
const SESSION_HISTORY_STORAGE_KEY = 'openintern.session_history';
const LOCALE_STORAGE_KEY = 'openintern.locale';
const TENANT_SCOPE_STORAGE_KEY = 'openintern.tenant_scope';
const DEFAULT_SESSION_KEY = 's_default';
const SESSION_PATTERN = /^s_[a-zA-Z0-9_]+$/;
const MAX_SESSION_HISTORY = 24;

export type AppLocale = 'en' | 'zh-CN';
export interface TenantScope {
  orgId: string;
  userId: string;
  projectId: string | null;
}

interface AppPreferencesContextValue {
  sessionKey: string;
  setSessionKey: (value: string) => void;
  sessionHistory: string[];
  createSession: () => string;
  removeSession: (value: string) => void;
  locale: AppLocale;
  setLocale: (value: AppLocale) => void;
  tenantScope: TenantScope;
  setTenantScope: (value: TenantScope) => void;
}

export const AppPreferencesContext = createContext<AppPreferencesContextValue | null>(null);

function normalizeSessionKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_SESSION_KEY;
  }

  if (SESSION_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const sanitized = trimmed.replace(/[^a-zA-Z0-9_]/g, '_');
  if (SESSION_PATTERN.test(sanitized)) {
    return sanitized;
  }

  return `s_${sanitized || 'default'}`;
}

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(key);
}

function readSessionHistory(): string[] {
  const raw = readStorage(SESSION_HISTORY_STORAGE_KEY);
  if (!raw) {
    return [DEFAULT_SESSION_KEY];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [DEFAULT_SESSION_KEY];
    }
    const normalized = parsed
      .filter((value): value is string => typeof value === 'string')
      .map(value => normalizeSessionKey(value))
      .filter((value, index, list) => list.indexOf(value) === index);
    return normalized.length > 0 ? normalized.slice(0, MAX_SESSION_HISTORY) : [DEFAULT_SESSION_KEY];
  } catch {
    return [DEFAULT_SESSION_KEY];
  }
}

function readLocale(): AppLocale {
  const raw = readStorage(LOCALE_STORAGE_KEY);
  return raw === 'zh-CN' ? 'zh-CN' : 'en';
}

function readTenantScope(): TenantScope {
  const fallback: TenantScope = {
    orgId: import.meta.env.VITE_ORG_ID ?? 'org_default',
    userId: import.meta.env.VITE_USER_ID ?? 'user_default',
    projectId: import.meta.env.VITE_PROJECT_ID ?? null,
  };

  const raw = readStorage(TENANT_SCOPE_STORAGE_KEY);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return fallback;
    }
    const record = parsed as Record<string, unknown>;
    const orgId = typeof record['orgId'] === 'string' && record['orgId'].trim().length > 0
      ? record['orgId'].trim()
      : fallback.orgId;
    const userId = typeof record['userId'] === 'string' && record['userId'].trim().length > 0
      ? record['userId'].trim()
      : fallback.userId;
    const projectId = typeof record['projectId'] === 'string'
      ? (record['projectId'].trim() || null)
      : fallback.projectId;
    return { orgId, userId, projectId };
  } catch {
    return fallback;
  }
}

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [sessionKey, setSessionKeyState] = useState<string>(() => {
    const stored = readStorage(SESSION_STORAGE_KEY);
    return stored ? normalizeSessionKey(stored) : DEFAULT_SESSION_KEY;
  });
  const [sessionHistory, setSessionHistory] = useState<string[]>(readSessionHistory);
  const [locale, setLocaleState] = useState<AppLocale>(readLocale);
  const [tenantScope, setTenantScopeState] = useState<TenantScope>(readTenantScope);

  useEffect(() => {
    window.localStorage.setItem(SESSION_STORAGE_KEY, sessionKey);
  }, [sessionKey]);

  useEffect(() => {
    const normalized = sessionHistory
      .map(item => normalizeSessionKey(item))
      .filter((value, index, list) => list.indexOf(value) === index)
      .slice(0, MAX_SESSION_HISTORY);
    if (normalized.length === 0) {
      normalized.push(DEFAULT_SESSION_KEY);
    }
    window.localStorage.setItem(SESSION_HISTORY_STORAGE_KEY, JSON.stringify(normalized));
  }, [sessionHistory]);

  useEffect(() => {
    setSessionHistory(prev => {
      if (prev.includes(sessionKey)) {
        return prev;
      }
      return [sessionKey, ...prev].slice(0, MAX_SESSION_HISTORY);
    });
  }, [sessionKey]);

  useEffect(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    window.localStorage.setItem(TENANT_SCOPE_STORAGE_KEY, JSON.stringify(tenantScope));
  }, [tenantScope]);

  const prependSessionHistory = useCallback((value: string) => {
    setSessionHistory(prev => [value, ...prev.filter(item => item !== value)].slice(0, MAX_SESSION_HISTORY));
  }, []);

  const setSessionKey = useCallback((value: string) => {
    const normalized = normalizeSessionKey(value);
    setSessionKeyState(normalized);
    prependSessionHistory(normalized);
  }, [prependSessionHistory]);

  const createSession = useCallback((): string => {
    const timestamp = Date.now().toString(36);
    const generated = normalizeSessionKey(`s_${timestamp}`);
    setSessionKeyState(generated);
    prependSessionHistory(generated);
    return generated;
  }, [prependSessionHistory]);

  const removeSession = useCallback((value: string) => {
    const normalized = normalizeSessionKey(value);
    setSessionHistory(prev => {
      const next = prev.filter(item => item !== normalized);
      if (next.length === 0) {
        next.push(DEFAULT_SESSION_KEY);
      }
      if (sessionKey === normalized) {
        setSessionKeyState(next[0] ?? DEFAULT_SESSION_KEY);
      }
      return next;
    });
  }, [sessionKey]);

  const setLocale = useCallback((value: AppLocale) => {
    setLocaleState(value);
  }, []);

  const setTenantScope = useCallback((value: TenantScope) => {
    setTenantScopeState({
      orgId: value.orgId.trim() || 'org_default',
      userId: value.userId.trim() || 'user_default',
      projectId: value.projectId?.trim() || null,
    });
  }, []);

  const value = useMemo(
    () => ({
      sessionKey,
      setSessionKey,
      sessionHistory,
      createSession,
      removeSession,
      locale,
      setLocale,
      tenantScope,
      setTenantScope,
    }),
    [
      sessionKey,
      setSessionKey,
      sessionHistory,
      createSession,
      removeSession,
      locale,
      setLocale,
      tenantScope,
      setTenantScope,
    ],
  );

  return (
    <AppPreferencesContext.Provider value={value}>
      {children}
    </AppPreferencesContext.Provider>
  );
}

export function useAppPreferences(): AppPreferencesContextValue {
  const context = useContext(AppPreferencesContext);
  if (!context) {
    throw new Error('useAppPreferences must be used inside AppPreferencesProvider');
  }
  return context;
}
