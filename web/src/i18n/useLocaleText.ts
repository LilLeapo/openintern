import { useCallback, useContext } from 'react';
import { AppPreferencesContext, type AppLocale } from '../context/AppPreferencesContext';

export function useLocaleText() {
  const preferences = useContext(AppPreferencesContext);
  const locale: AppLocale = preferences?.locale ?? 'en';
  const isZh = locale === 'zh-CN';

  const t = useCallback(
    (en: string, zh: string) => (isZh ? zh : en),
    [isZh],
  );

  return { locale, isZh, t };
}
