'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Language } from '@/types';

interface LocaleContextType {
  locale: Language;
  setLocale: (lang: Language) => void;
}

const LocaleContext = createContext<LocaleContextType | null>(null);

const DEFAULT_LOCALE: Language = 'zh-CN';
const STORAGE_KEY = 'locale';

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Language>(DEFAULT_LOCALE);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (stored) setLocaleState(stored as Language);
  }, []);

  const setLocale = useCallback((lang: Language) => {
    setLocaleState(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, lang);
    }
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocaleContext() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocaleContext must be used within LocaleProvider');
  return ctx;
}
