import React, { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react';
import { TRANSLATIONS, type SupportedLocale, type AppTranslations } from './translations';

interface I18nContextType {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: AppTranslations;
  isRtl: boolean;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const STORAGE_KEY = 'pos_locale_preference';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'ur' || saved === 'en') {
        return saved;
      }
    } catch {
      // Fallback
    }
    return 'en';
  });

  const setLocale = (newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
    } catch (e) {
      console.warn('Failed to persist locale preference', e);
    }
  };

  useEffect(() => {
    const isRtl = locale === 'ur';
    document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', locale);
    if (isRtl) {
      document.body.classList.add('rtl-active');
    } else {
      document.body.classList.remove('rtl-active');
    }
  }, [locale]);

  const value = useMemo<I18nContextType>(() => {
    return {
      locale,
      setLocale,
      t: TRANSLATIONS[locale] || TRANSLATIONS.en,
      isRtl: locale === 'ur',
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextType {
  const context = useContext(I18nContext);
  if (!context) {
    // Provide safe fallback if invoked outside provider
    return {
      locale: 'en',
      setLocale: () => {},
      t: TRANSLATIONS.en,
      isRtl: false,
    };
  }
  return context;
}
