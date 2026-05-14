'use client';

import { useState, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLocale } from '@/hooks/useLocale';
import { useClickOutside } from '@/hooks/useClickOutside';
import { LANGUAGES } from '@/lib/constants';
import { UserMenuPopover } from './UserMenuPopover';
import { Zap } from 'lucide-react';

export function TopBar() {
  const { user } = useAuth();
  const { locale, setLocale } = useLocale();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const langRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useClickOutside(langRef, () => setShowLangMenu(false));
  useClickOutside(userRef, () => setShowUserMenu(false));

  const currentLang = LANGUAGES.find(l => l.value === locale);

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between bg-white px-8 border-b border-[var(--color-border)]">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-[var(--color-dark)] flex items-center justify-center">
          <span className="text-white text-xs font-bold">O</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-semibold tracking-tight">Oneness-AI</span>
          <span className="text-xs text-[var(--color-text-secondary)] bg-gray-100 px-1 py-0.5 rounded">.ai</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative" ref={langRef}>
          <button
            onClick={() => setShowLangMenu(!showLangMenu)}
            className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
          >
            {currentLang?.label}
          </button>
          {showLangMenu && (
            <div className="absolute right-0 top-full mt-2 w-40 bg-white rounded-lg shadow-lg border border-[var(--color-border)] py-1 z-50">
              {LANGUAGES.map(lang => (
                <button
                  key={lang.value}
                  onClick={() => { setLocale(lang.value); setShowLangMenu(false); }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
                    locale === lang.value ? 'text-[var(--color-primary)] font-medium' : 'text-[var(--color-text)]'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="flex items-center gap-2 bg-[var(--color-dark)] text-white text-xs px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors">
          <span>充值</span>
          <Zap className="w-3.5 h-3.5" />
          <span>{user?.credits ?? 0}</span>
        </button>

        <div className="relative" ref={userRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center hover:bg-gray-300 transition-colors"
          >
            <span className="text-sm text-gray-600">{user?.name?.[0] ?? 'U'}</span>
          </button>
          {showUserMenu && (
            <UserMenuPopover onClose={() => setShowUserMenu(false)} />
          )}
        </div>
      </div>
    </header>
  );
}
