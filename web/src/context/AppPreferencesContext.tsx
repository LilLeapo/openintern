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
const GROUP_STORAGE_KEY = 'openintern.group_id';
const LOCALE_STORAGE_KEY = 'openintern.locale';
const DEFAULT_SESSION_KEY = 's_default';
const SESSION_PATTERN = /^s_[a-zA-Z0-9_]+$/;
const MAX_SESSION_HISTORY = 24;

export type AppLocale = 'en' | 'zh-CN';

interface AppPreferencesContextValue {
  sessionKey: string;
  setSessionKey: (value: string) => void;
  sessionHistory: string[];
  createSession: () => string;
  removeSession: (value: string) => void;
  selectedGroupId: string | null;
  setSelectedGroupId: (value: string | null) => void;
  locale: AppLocale;
  setLocale: (value: AppLocale) => void;
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

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [sessionKey, setSessionKeyState] = useState<string>(() => {
    const stored = readStorage(SESSION_STORAGE_KEY);
    return stored ? normalizeSessionKey(stored) : DEFAULT_SESSION_KEY;
  });
  const [sessionHistory, setSessionHistory] = useState<string[]>(readSessionHistory);
  const [selectedGroupId, setSelectedGroupIdState] = useState<string | null>(() =>
    readStorage(GROUP_STORAGE_KEY),
  );
  const [locale, setLocaleState] = useState<AppLocale>(readLocale);

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
    if (selectedGroupId) {
      window.localStorage.setItem(GROUP_STORAGE_KEY, selectedGroupId);
      return;
    }
    window.localStorage.removeItem(GROUP_STORAGE_KEY);
  }, [selectedGroupId]);

  useEffect(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

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

  const setSelectedGroupId = useCallback((value: string | null) => {
    setSelectedGroupIdState(value);
  }, []);

  const setLocale = useCallback((value: AppLocale) => {
    setLocaleState(value);
  }, []);

  const value = useMemo(
    () => ({
      sessionKey,
      setSessionKey,
      sessionHistory,
      createSession,
      removeSession,
      selectedGroupId,
      setSelectedGroupId,
      locale,
      setLocale,
    }),
    [
      sessionKey,
      setSessionKey,
      sessionHistory,
      createSession,
      removeSession,
      selectedGroupId,
      setSelectedGroupId,
      locale,
      setLocale,
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
