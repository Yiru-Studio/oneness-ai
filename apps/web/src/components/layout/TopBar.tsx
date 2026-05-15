'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useLocale } from '@/hooks/useLocale';
import { useClickOutside } from '@/hooks/useClickOutside';
import { LANGUAGES } from '@/lib/constants';
import { UserMenuPopover } from './UserMenuPopover';
import { Zap, Pencil, Check, X } from 'lucide-react';
import { Project } from '@/types';
import { updateProject } from '@/lib/api';
import type { UpdateProjectInput } from '@oneness/shared';

interface Props {
  project?: Project | null;
  onProjectUpdated?: (project: Project) => void;
}

function LikeAILogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="10" r="8" fill="currentColor" />
      <circle cx="8" cy="20" r="6" fill="currentColor" />
    </svg>
  );
}

export function TopBar({ project, onProjectUpdated }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const { locale, setLocale } = useLocale();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(project?.name ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const langRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useClickOutside(langRef, () => setShowLangMenu(false));
  useClickOutside(userRef, () => setShowUserMenu(false));

  const currentLang = LANGUAGES.find(l => l.value === locale);

  const handleSaveName = async () => {
    if (!project || !editName.trim() || editName.trim() === project.name) {
      setIsEditingName(false);
      setEditName(project?.name ?? '');
      return;
    }
    setIsSaving(true);
    try {
      const patch: UpdateProjectInput = { name: editName.trim() };
      const updated = await updateProject(project.id, patch);
      onProjectUpdated?.(updated);
      setIsEditingName(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditingName(false);
    setEditName(project?.name ?? '');
  };

  const startEditing = () => {
    setEditName(project?.name ?? '');
    setIsEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveName();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between bg-white px-8 border-b border-[var(--color-border)]">
      {/* Left: Logo + project name (or branding) */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/projects')}
          className="flex items-center justify-center text-black hover:opacity-70 transition-opacity"
          title="回到项目列表"
        >
          <LikeAILogo />
        </button>

        {project ? (
          <div className="flex items-center gap-1.5">
            {isEditingName ? (
              <div className="flex items-center gap-1">
                <input
                  ref={nameInputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={handleNameKeyDown}
                  disabled={isSaving}
                  className="text-base font-semibold border border-[var(--color-border)] rounded px-2 py-0.5 w-48 focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                />
                <button
                  onClick={handleSaveName}
                  disabled={isSaving}
                  className="p-0.5 rounded hover:bg-gray-100 text-[var(--color-success)] transition-colors"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  className="p-0.5 rounded hover:bg-gray-100 text-gray-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                <span className="text-base font-semibold text-[var(--color-text)]">
                  {project.name}
                </span>
                <button
                  onClick={startEditing}
                  className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-[var(--color-text)] transition-colors"
                  title="修改项目名称"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-semibold tracking-tight">LikeAI</span>
            <span className="text-xs text-[var(--color-text-secondary)] bg-gray-100 px-1 py-0.5 rounded">.pro</span>
          </div>
        )}
      </div>

      {/* Right: language, credits, user */}
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
