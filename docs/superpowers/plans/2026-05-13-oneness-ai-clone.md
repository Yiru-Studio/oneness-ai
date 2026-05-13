# Oneness-AI UI Clone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clone likeai.pro UI with Oneness-AI branding using Next.js 16 + React 19 + Tailwind CSS v4, with mock data and clean API interface for future backend integration.

**Architecture:** Next.js App Router with React Context for state management. All data operations isolated in `lib/api.ts` (currently mock, designed for easy replacement with real fetch calls). Component-first organization with clear boundaries.

**Tech Stack:** Next.js 16.2.1, React 19.2.4, Tailwind CSS v4, shadcn/ui, TypeScript 5, Lucide React

---

## File Structure Overview

```
src/
  app/
    layout.tsx                    # Root layout with Context providers
    page.tsx                      # Home page (hero + particle background)
    globals.css                   # Global styles, CSS variables
    projects/
      page.tsx                    # Project list page
      [id]/
        page.tsx                  # Project detail page
    knowledge-base/
      page.tsx                    # Knowledge base page
    profile/
      page.tsx                    # Profile page
  components/
    ui/                           # shadcn/ui primitives (already exists)
    layout/
      TopBar.tsx                  # Global top navigation bar
      UserMenuPopover.tsx         # User dropdown menu
      FloatingKnowledgeButton.tsx # Fixed bottom-right FAB
    modals/
      LoginModal.tsx              # Email + verification code login
      CreateProjectModal.tsx      # New project creation dialog
    projects/
      ProjectCard.tsx             # Individual project card (2 variants)
      ProjectGrid.tsx             # Grid container for cards
      ProjectFilters.tsx          # Search + reset controls
      ProjectInfoPanel.tsx        # Left sidebar info on detail page
      ProjectTabs.tsx             # Tab navigation (info/characters/etc)
      ProjectTabContent.tsx       # Content area for active tab
    knowledge/
      DocSidebar.tsx              # Left document panel
      DocToolbar.tsx              # Vertical icon toolbar
      EmptyState.tsx              # Empty state illustration
    profile/
      ProfileForm.tsx             # User info edit form
  contexts/
    AuthContext.tsx               # Login state + user info
    LocaleContext.tsx             # Language selection
  hooks/
    useAuth.ts                    # Convenience hook for AuthContext
    useLocale.ts                  # Convenience hook for LocaleContext
  lib/
    api.ts                        # All data operations (mock)
    utils.ts                      # cn() utility (already exists)
    constants.ts                  # Language list, app constants
  types/
    index.ts                      # All TypeScript interfaces
  data/
    mock.ts                       # Mock data for all entities
```

---

## Task 1: Clean Up Template & Verify Base

**Files:**
- Modify: `package.json`
- Delete: `src/app/page.tsx`, `src/components/ui/button.tsx`, `.claude/`, `.cursor/`, `.gemini/`, `.opencode/`, `.windsurfrules`, `.clinerules`, `.aider.conf.yml`, `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`

- [ ] **Step 1: Remove agent-specific files and clean page.tsx**

```bash
cd /home/liuz747/Jobs/oneness-ai
rm -rf .claude .cursor .gemini .opencode .amazonq
rm -f .windsurfrules .clinerules .aider.conf.yml CLAUDE.md GEMINI.md AGENTS.md
rm -f src/app/page.tsx src/components/ui/button.tsx
```

- [ ] **Step 2: Verify template builds**

```bash
cd /home/liuz747/Jobs/oneness-ai
npm install 2>&1 | tail -5
npm run build 2>&1 | tail -10
```

Expected: Build succeeds (may have warnings about missing page.tsx, that's ok).

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "chore: clean up template files for oneness-ai clone"
```

---

## Task 2: Type Definitions

**Files:**
- Create: `src/types/index.ts`

- [ ] **Step 1: Write all type definitions**

```typescript
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  credits: number;
}

export interface Project {
  id: string;
  name: string;
  ratio: string;
  style: string;
  createdAt: string;
  stylePrompt: string;
  analysisModel: string;
  imageModel: string;
  videoModel: string;
  generalAnalysis: 'pending' | 'completed';
  basicAnalysis: 'pending' | 'completed';
}

export type ProjectTab = 'info' | 'characters' | 'items' | 'scenes' | 'workbench' | 'storyboard' | 'analytics';

export interface ProjectTabContent {
  tab: ProjectTab;
  content: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  type: 'created' | 'favorited' | 'collaborated';
  content?: string;
  createdAt: string;
}

export type Language = 'zh-CN' | 'en' | 'zh-TW' | 'ja' | 'ko' | 'es' | 'fr' | 'de';

export interface LanguageOption {
  value: Language;
  label: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add type definitions for User, Project, KnowledgeDoc"
```

---

## Task 3: Constants & Mock Data

**Files:**
- Create: `src/lib/constants.ts`
- Create: `src/data/mock.ts`

- [ ] **Step 1: Write constants**

```typescript
export const LANGUAGES = [
  { value: 'zh-CN' as const, label: '简体中文' },
  { value: 'en' as const, label: 'English' },
  { value: 'zh-TW' as const, label: '繁體中文' },
  { value: 'ja' as const, label: '日本語' },
  { value: 'ko' as const, label: '한국어' },
  { value: 'es' as const, label: 'Español' },
  { value: 'fr' as const, label: 'Français' },
  { value: 'de' as const, label: 'Deutsch' },
] as const;

export const PROJECT_TABS = [
  { value: 'info' as const, label: '信息' },
  { value: 'characters' as const, label: '角色' },
  { value: 'items' as const, label: '物品' },
  { value: 'scenes' as const, label: '场景' },
  { value: 'workbench' as const, label: '工作台' },
  { value: 'storyboard' as const, label: '分镜' },
  { value: 'analytics' as const, label: '数据分析' },
] as const;

export const KNOWLEDGE_TABS = [
  { value: 'created' as const, label: '我创建的' },
  { value: 'favorited' as const, label: '我收藏的' },
  { value: 'collaborated' as const, label: '与我协作' },
] as const;
```

- [ ] **Step 2: Write mock data**

```typescript
import { User, Project, KnowledgeDoc } from '@/types';

export const mockUser: User = {
  id: '6a04202d3befef5ce911208e',
  email: '1280165525@qq.com',
  name: '黄昱舟',
  credits: 10158,
};

export const mockProjects: Project[] = [
  {
    id: '6a042d2e79ad459e57137732',
    name: '格斗动画',
    ratio: '16:9',
    style: '日漫风格',
    createdAt: '2026-05-13T15:50:06',
    stylePrompt: '精细的素描和简洁的线条，日式漫画风格，武道主题。故事围绕一位格斗选手展开，场景包括道场、城市街头和地下格斗场。角色设计强调力量感和速度感，配色以深蓝、黑色和金色为主。',
    analysisModel: 'Gemini 3 Pro',
    imageModel: 'Nano banana pro',
    videoModel: 'Seedance 2.0',
    generalAnalysis: 'completed',
    basicAnalysis: 'completed',
  },
  {
    id: '6a042d2e79ad459e57137733',
    name: '格斗',
    ratio: '16:9',
    style: '电影质感',
    createdAt: '2026-05-12T10:30:00',
    stylePrompt: '电影级画质，写实风格，强调光影对比和景深效果。动作场面采用快速剪辑和慢镜头结合，色调偏冷，以蓝灰色为主。',
    analysisModel: 'Gemini 3 Pro',
    imageModel: 'Nano banana pro',
    videoModel: 'Seedance 2.0',
    generalAnalysis: 'completed',
    basicAnalysis: 'completed',
  },
];

export const mockKnowledgeDocs: KnowledgeDoc[] = [];

export const mockProjectTabContent: Record<string, string> = {
  info: `故事背景设定在一个近未来的世界，武术"极意"成为了全球主流竞技项目。

主角是一位名叫李昊的年轻格斗家，他在一场国际邀请赛后意外卷入了一个神秘组织的阴谋。这个组织试图利用"极意"技术控制全球能源命脉。

李昊必须联合来自不同国家的格斗家，包括日本的空手道高手、巴西的柔术冠军、泰国的泰拳王者，共同对抗这个组织。

在旅途中，李昊逐渐发现了自己体内潜藏的特殊能力——"共鸣"，这种能力让他能够短暂预知对手的动作。但随着能力的觉醒，他也面临着身体被能力反噬的危险。

最终决战发生在组织的总部，一座隐藏在太平洋深处的浮空城市。李昊必须在保护同伴和拯救世界之间做出选择...`,
  characters: '角色信息将在此展示...',
  items: '物品信息将在此展示...',
  scenes: '场景信息将在此展示...',
  workbench: '工作台内容将在此展示...',
  storyboard: '分镜内容将在此展示...',
  analytics: '数据分析将在此展示...',
};
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/constants.ts src/data/mock.ts
git commit -m "feat: add constants and mock data"
```

---

## Task 4: API Layer (Mock Interface)

**Files:**
- Create: `src/lib/api.ts`

- [ ] **Step 1: Write API layer with mock data**

```typescript
import { User, Project, KnowledgeDoc, ProjectTabContent } from '@/types';
import { mockUser, mockProjects, mockKnowledgeDocs, mockProjectTabContent } from '@/data/mock';

// Simulate network delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// User
export async function getCurrentUser(): Promise<User | null> {
  await delay(300);
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { ...mockUser } : null;
}

export async function login(email: string, _code: string): Promise<{ token: string }> {
  await delay(500);
  const token = 'mock_token_' + Date.now();
  if (typeof window !== 'undefined') {
    localStorage.setItem('auth_token', token);
  }
  return { token };
}

export async function logout(): Promise<void> {
  await delay(200);
  if (typeof window !== 'undefined') {
    localStorage.removeItem('auth_token');
  }
}

export async function updateProfile(data: Partial<User>): Promise<User> {
  await delay(300);
  return { ...mockUser, ...data };
}

// Projects
export async function getProjects(search?: string): Promise<Project[]> {
  await delay(300);
  let projects = [...mockProjects];
  if (search) {
    projects = projects.filter(p => p.name.includes(search));
  }
  return projects;
}

export async function getProject(id: string): Promise<Project | null> {
  await delay(300);
  return mockProjects.find(p => p.id === id) || null;
}

export async function createProject(data: Omit<Project, 'id' | 'createdAt'>): Promise<Project> {
  await delay(500);
  return {
    ...data,
    id: 'proj_' + Date.now(),
    createdAt: new Date().toISOString(),
  };
}

export async function deleteProject(_id: string): Promise<void> {
  await delay(300);
}

export async function getProjectTabContent(
  _projectId: string,
  tab: string
): Promise<ProjectTabContent> {
  await delay(400);
  return {
    tab: tab as ProjectTabContent['tab'],
    content: mockProjectTabContent[tab] || '暂无内容',
  };
}

// Knowledge
export async function getKnowledgeDocs(type: string): Promise<KnowledgeDoc[]> {
  await delay(300);
  return mockKnowledgeDocs.filter(d => d.type === type);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add mock API layer with isolated data operations"
```

---

## Task 5: AuthContext

**Files:**
- Create: `src/contexts/AuthContext.tsx`
- Create: `src/hooks/useAuth.ts`

- [ ] **Step 1: Write AuthContext**

```typescript
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User } from '@/types';
import { getCurrentUser, login as apiLogin, logout as apiLogout } from '@/lib/api';

interface AuthContextType {
  isLoggedIn: boolean;
  user: User | null;
  isLoading: boolean;
  login: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getCurrentUser().then(u => {
      setUser(u);
      setIsLoading(false);
    });
  }, []);

  const login = useCallback(async (email: string, code: string) => {
    await apiLogin(email, code);
    const u = await getCurrentUser();
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{
      isLoggedIn: !!user,
      user,
      isLoading,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}
```

- [ ] **Step 2: Write useAuth hook**

```typescript
export { useAuthContext as useAuth } from '@/contexts/AuthContext';
```

- [ ] **Step 3: Commit**

```bash
git add src/contexts/AuthContext.tsx src/hooks/useAuth.ts
git commit -m "feat: add AuthContext with localStorage token persistence"
```

---

## Task 6: LocaleContext

**Files:**
- Create: `src/contexts/LocaleContext.tsx`
- Create: `src/hooks/useLocale.ts`

- [ ] **Step 1: Write LocaleContext**

```typescript
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
```

- [ ] **Step 2: Write useLocale hook**

```typescript
export { useLocaleContext as useLocale } from '@/contexts/LocaleContext';
```

- [ ] **Step 3: Commit**

```bash
git add src/contexts/LocaleContext.tsx src/hooks/useLocale.ts
git commit -m "feat: add LocaleContext with localStorage persistence"
```

---

## Task 7: Root Layout with Providers

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Update layout.tsx with providers**

```typescript
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { LocaleProvider } from "@/contexts/LocaleContext";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Oneness-AI — 专业 AI 影视创作",
  description: "Oneness-AI 专业 AI 影视创作平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${inter.variable} font-sans antialiased`}>
        <LocaleProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Update globals.css with design tokens**

```css
@import "tailwindcss";

@theme {
  --font-sans: var(--font-inter), "Noto Sans SC", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;

  --color-primary: #3b82f6;
  --color-primary-hover: #2563eb;
  --color-bg: #ffffff;
  --color-bg-card: #fafafa;
  --color-bg-sidebar: #f5f5f5;
  --color-text: #111827;
  --color-text-secondary: #6b7280;
  --color-border: #e5e7eb;
  --color-success: #22c55e;
  --color-danger: #ef4444;
  --color-dark: #111111;
}

body {
  color: var(--color-text);
  background: var(--color-bg);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css
git commit -m "feat: wire up Auth and Locale providers in root layout"
```

---

## Task 8: TopBar Component

**Files:**
- Create: `src/components/layout/TopBar.tsx`

- [ ] **Step 1: Write TopBar component**

```typescript
'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLocale } from '@/hooks/useLocale';
import { LANGUAGES } from '@/lib/constants';
import { UserMenuPopover } from './UserMenuPopover';
import { Zap } from 'lucide-react';

export function TopBar() {
  const { user } = useAuth();
  const { locale, setLocale } = useLocale();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const currentLang = LANGUAGES.find(l => l.value === locale);

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between bg-white px-8 border-b border-[var(--color-border)]">
      {/* Brand */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-[var(--color-dark)] flex items-center justify-center">
          <span className="text-white text-xs font-bold">O</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-semibold tracking-tight">Oneness-AI</span>
          <span className="text-xs text-[var(--color-text-secondary)] bg-gray-100 px-1 py-0.5 rounded">.ai</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4">
        {/* Language selector */}
        <div className="relative">
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

        {/* Credits button */}
        <button className="flex items-center gap-2 bg-[var(--color-dark)] text-white text-xs px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors">
          <span>充值</span>
          <Zap className="w-3.5 h-3.5" />
          <span>{user?.credits ?? 0}</span>
        </button>

        {/* Avatar */}
        <div className="relative">
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/TopBar.tsx
git commit -m "feat: add TopBar with brand, language selector, credits, avatar"
```

---

## Task 9: UserMenuPopover Component

**Files:**
- Create: `src/components/layout/UserMenuPopover.tsx`

- [ ] **Step 1: Write UserMenuPopover**

```typescript
'use client';

import { useAuth } from '@/hooks/useAuth';
import { Settings, HelpCircle, LogOut, ChevronRight } from 'lucide-react';

interface Props {
  onClose: () => void;
}

export function UserMenuPopover({ onClose }: Props) {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    onClose();
    window.location.href = '/';
  };

  return (
    <div className="absolute right-0 top-full mt-2 w-[280px] bg-white rounded-xl shadow-lg border border-[var(--color-border)] py-4 z-50"
         onClick={e => e.stopPropagation()}>
      {/* Profile */}
      <div className="flex items-center gap-4 px-4 pb-4 border-b border-[var(--color-border)]">
        <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center relative">
          <span className="text-3xl text-gray-400">{user?.name?.[0] ?? 'U'}</span>
          <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer">
            <span className="text-white text-xs">更换</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[var(--color-text)]">{user?.name}</div>
          <div className="text-sm text-[var(--color-text-secondary)] truncate">{user?.email}</div>
        </div>
      </div>

      {/* Credits */}
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-secondary)]">积分</span>
          <div className="flex items-center gap-1">
            <span className="font-medium">{user?.credits}</span>
            <ChevronRight className="w-4 h-4 text-[var(--color-text-secondary)]" />
          </div>
        </div>
      </div>

      {/* Menu items */}
      <div className="px-2 pt-2">
        <a href="/profile" className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm text-[var(--color-text)]">
          <Settings className="w-4 h-4 text-[var(--color-text-secondary)]" />
          <span>账户管理</span>
        </a>
        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm text-[var(--color-text)]">
          <HelpCircle className="w-4 h-4 text-[var(--color-text-secondary)]" />
          <span>使用指南</span>
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors text-sm text-[var(--color-text)]"
        >
          <LogOut className="w-4 h-4 text-[var(--color-text-secondary)]" />
          <span>退出登录</span>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/UserMenuPopover.tsx
git commit -m "feat: add UserMenuPopover with profile, credits, menu items"
```

---

## Task 10: LoginModal Component

**Files:**
- Create: `src/components/modals/LoginModal.tsx`

- [ ] **Step 1: Write LoginModal**

```typescript
'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: Props) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [isLoading, setIsLoading] = useState(false);

  const handleSendCode = () => {
    if (!email) return;
    setStep('code');
  };

  const handleLogin = async () => {
    if (!code) return;
    setIsLoading(true);
    try {
      await login(email, code);
      onClose();
      window.location.href = '/projects';
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50"
         onClick={onClose}>
      <div className="bg-white rounded-2xl p-8 w-[400px] relative"
           onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-semibold text-center mb-2">欢迎来到 Oneness-AI</h2>
        <p className="text-sm text-[var(--color-text-secondary)] text-center mb-6">
          使用邮箱继续
        </p>

        {step === 'email' ? (
          <div className="space-y-4">
            <input
              type="email"
              placeholder="电子邮箱"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors"
            />
            <button
              onClick={handleSendCode}
              disabled={!email}
              className="w-full bg-[var(--color-primary)] text-white py-3 rounded-xl font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              使用邮箱继续
            </button>
            <p className="text-xs text-[var(--color-text-secondary)] text-center">
              未注册的邮箱将自动创建账号
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-[var(--color-text-secondary)] text-center mb-2">
              验证码已发送至 {email}
            </div>
            <input
              type="text"
              placeholder="请输入验证码"
              value={code}
              onChange={e => setCode(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors text-center text-2xl tracking-[0.5em]"
              maxLength={6}
            />
            <button
              onClick={handleLogin}
              disabled={!code || isLoading}
              className="w-full bg-[var(--color-primary)] text-white py-3 rounded-xl font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? '登录中...' : '登录'}
            </button>
            <button
              onClick={() => setStep('email')}
              className="w-full text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors"
            >
              更换邮箱
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/modals/LoginModal.tsx
git commit -m "feat: add LoginModal with email + verification code flow"
```

---

## Task 11: FloatingKnowledgeButton

**Files:**
- Create: `src/components/layout/FloatingKnowledgeButton.tsx`

- [ ] **Step 1: Write FloatingKnowledgeButton**

```typescript
'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';

export function FloatingKnowledgeButton() {
  const [showLabel, setShowLabel] = useState(false);

  return (
    <a
      href="/knowledge-base"
      className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2"
      onMouseEnter={() => setShowLabel(true)}
      onMouseLeave={() => setShowLabel(false)}
    >
      {showLabel && (
        <span className="bg-gray-800 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap">
          知识库
        </span>
      )}
      <div className="w-12 h-12 rounded-full bg-white shadow-lg border border-[var(--color-border)] flex items-center justify-center hover:shadow-xl transition-shadow">
        <FileText className="w-5 h-5 text-[var(--color-text)]" />
      </div>
    </a>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/FloatingKnowledgeButton.tsx
git commit -m "feat: add floating knowledge base button"
```

---

## Task 12: CreateProjectModal

**Files:**
- Create: `src/components/modals/CreateProjectModal.tsx`

- [ ] **Step 1: Write CreateProjectModal**

```typescript
'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, ratio: string) => void;
}

const RATIOS = ['16:9', '9:16', '1:1', '4:3'];

export function CreateProjectModal({ isOpen, onClose, onCreate }: Props) {
  const [name, setName] = useState('');
  const [ratio, setRatio] = useState('16:9');

  const handleSubmit = () => {
    if (!name) return;
    onCreate(name, ratio);
    setName('');
    setRatio('16:9');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50"
         onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-[480px] relative"
           onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-lg font-semibold mb-6">创建项目</h2>

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">项目名称</label>
            <input
              type="text"
              placeholder="请输入项目名称"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">画面比例</label>
            <div className="flex gap-3">
              {RATIOS.map(r => (
                <button
                  key={r}
                  onClick={() => setRatio(r)}
                  className={`flex-1 py-3 rounded-xl border transition-colors ${
                    ratio === r
                      ? 'border-[var(--color-primary)] bg-blue-50 text-[var(--color-primary)]'
                      : 'border-[var(--color-border)] hover:border-gray-300'
                  }`}
                >
                  <span className="text-sm font-medium">{r}</span>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!name}
            className="w-full bg-[var(--color-primary)] text-white py-3 rounded-xl font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/modals/CreateProjectModal.tsx
git commit -m "feat: add CreateProjectModal with name and ratio selection"
```

---

## Task 13: Home Page

**Files:**
- Create: `src/app/page.tsx`
- Create: `src/components/home/ParticleBackground.tsx`

- [ ] **Step 1: Write ParticleBackground**

```typescript
'use client';

import { useEffect, useRef } from 'react';

export function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const particles: Array<{
      x: number; y: number; size: number;
      speedX: number; speedY: number; opacity: number;
    }> = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Create particles
    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 3 + 1,
        speedX: (Math.random() - 0.5) * 0.3,
        speedY: (Math.random() - 0.5) * 0.3,
        opacity: Math.random() * 0.5 + 0.1,
      });
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw gradient background
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, '#f0f4f8');
      gradient.addColorStop(0.5, '#e8eef5');
      gradient.addColorStop(1, '#f5f0e8');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw particles
      particles.forEach(p => {
        p.x += p.speedX;
        p.y += p.speedY;

        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180, 190, 210, ${p.opacity})`;
        ctx.fill();
      });

      // Draw light beams
      const beamGradient = ctx.createLinearGradient(
        canvas.width * 0.3, -100,
        canvas.width * 0.7, canvas.height * 0.8
      );
      beamGradient.addColorStop(0, 'rgba(200, 210, 230, 0)');
      beamGradient.addColorStop(0.3, 'rgba(200, 210, 230, 0.15)');
      beamGradient.addColorStop(0.5, 'rgba(220, 200, 180, 0.1)');
      beamGradient.addColorStop(1, 'rgba(200, 210, 230, 0)');
      ctx.fillStyle = beamGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ zIndex: 0 }}
    />
  );
}
```

- [ ] **Step 2: Write Home page**

```typescript
'use client';

import { useState } from 'react';
import { LoginModal } from '@/components/modals/LoginModal';
import { FloatingKnowledgeButton } from '@/components/layout/FloatingKnowledgeButton';
import { ParticleBackground } from '@/components/home/ParticleBackground';
import { Play } from 'lucide-react';

export default function HomePage() {
  const [showLogin, setShowLogin] = useState(false);

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
      <ParticleBackground />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-8 py-5 z-10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-[var(--color-dark)] flex items-center justify-center">
            <span className="text-white text-xs font-bold">O</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-semibold">Oneness-AI</span>
            <span className="text-xs text-[var(--color-text-secondary)] bg-gray-100 px-1 py-0.5 rounded">.ai</span>
          </div>
        </div>
        <button
          onClick={() => setShowLogin(true)}
          className="text-sm text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors"
        >
          登录
        </button>
      </div>

      {/* Hero content */}
      <div className="relative z-10 text-center">
        <h1 className="text-5xl font-bold tracking-tight mb-3">
          Oneness-AI
          <span className="ml-2 text-sm font-normal text-[var(--color-text-secondary)] bg-gray-100 px-2 py-1 rounded align-middle">
            .ai
          </span>
        </h1>
        <p className="text-lg text-[var(--color-text-secondary)] mb-8">
          专业 AI 影视创作
        </p>
        <button
          onClick={() => setShowLogin(true)}
          className="inline-flex items-center gap-2 bg-[var(--color-primary)] text-white px-8 py-3.5 rounded-full font-medium hover:bg-[var(--color-primary-hover)] hover:scale-105 transition-all shadow-lg shadow-blue-500/25"
        >
          <span>立即创作</span>
          <Play className="w-4 h-4 fill-current" />
        </button>
      </div>

      {/* Login modal */}
      <LoginModal isOpen={showLogin} onClose={() => setShowLogin(false)} />

      {/* Floating knowledge button */}
      <FloatingKnowledgeButton />
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx src/components/home/ParticleBackground.tsx
git commit -m "feat: add home page with particle background and hero"
```

---

## Task 14: ProjectCard & ProjectGrid

**Files:**
- Create: `src/components/projects/ProjectCard.tsx`
- Create: `src/components/projects/ProjectGrid.tsx`

- [ ] **Step 1: Write ProjectCard**

```typescript
'use client';

import { Project } from '@/types';
import { Video, Plus, Trash2 } from 'lucide-react';

interface ProjectCardProps {
  project?: Project;
  isCreateCard?: boolean;
  onCreate?: () => void;
  onDelete?: (id: string) => void;
}

export function ProjectCard({ project, isCreateCard, onCreate, onDelete }: ProjectCardProps) {
  if (isCreateCard) {
    return (
      <button
        onClick={onCreate}
        className="card card-lg card-cta group flex flex-col items-center justify-center gap-3 bg-[var(--color-bg-card)] rounded-2xl h-[245px] border-2 border-transparent hover:border-gray-300 transition-colors"
      >
        <Plus className="w-10 h-10 text-gray-400 group-hover:text-gray-600 transition-colors" />
        <span className="text-sm font-medium text-gray-500 group-hover:text-gray-700">新建项目</span>
      </button>
    );
  }

  if (!project) return null;

  return (
    <a
      href={`/projects/${project.id}`}
      className="card card-lg card-project group relative flex flex-col bg-[var(--color-bg-card)] rounded-2xl h-[245px] p-6 hover:shadow-md transition-shadow"
    >
      {/* Delete button */}
      <button
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          onDelete?.(project.id);
        }}
        className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-[var(--color-danger)] hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {/* Icon */}
      <div className="flex-1 flex items-center justify-center">
        <Video className="w-12 h-12 text-gray-400" />
      </div>

      {/* Info */}
      <div className="mt-auto">
        <h3 className="font-semibold text-[var(--color-text)] mb-2">{project.name}</h3>
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
          <span className="meta-item">{project.ratio}</span>
          <span className="meta-item">{project.style}</span>
        </div>
      </div>
    </a>
  );
}
```

- [ ] **Step 2: Write ProjectGrid**

```typescript
'use client';

import { Project } from '@/types';
import { ProjectCard } from './ProjectCard';

interface Props {
  projects: Project[];
  onCreate: () => void;
  onDelete: (id: string) => void;
}

export function ProjectGrid({ projects, onCreate, onDelete }: Props) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(352px,1fr))] gap-6">
      <ProjectCard isCreateCard onCreate={onCreate} />
      {projects.map(project => (
        <ProjectCard key={project.id} project={project} onDelete={onDelete} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/projects/ProjectCard.tsx src/components/projects/ProjectGrid.tsx
git commit -m "feat: add ProjectCard and ProjectGrid components"
```

---

## Task 15: ProjectFilters & Projects Page

**Files:**
- Create: `src/components/projects/ProjectFilters.tsx`
- Create: `src/app/projects/page.tsx`

- [ ] **Step 1: Write ProjectFilters**

```typescript
'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';

interface Props {
  onSearch: (query: string) => void;
  onReset: () => void;
}

export function ProjectFilters({ onSearch, onReset }: Props) {
  const [query, setQuery] = useState('');

  const handleSearch = () => {
    onSearch(query);
  };

  const handleReset = () => {
    setQuery('');
    onReset();
  };

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="请输入项目名称（模糊）"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          className="pl-9 pr-4 py-2 w-64 rounded-xl border border-[var(--color-border)] text-sm focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors"
        />
      </div>
      <button
        onClick={handleSearch}
        className="px-5 py-2 bg-[var(--color-primary)] text-white text-sm font-medium rounded-xl hover:bg-[var(--color-primary-hover)] transition-colors"
      >
        搜索
      </button>
      <button
        onClick={handleReset}
        className="px-5 py-2 border border-[var(--color-border)] text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
      >
        重置
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write Projects page**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Project } from '@/types';
import { getProjects } from '@/lib/api';
import { TopBar } from '@/components/layout/TopBar';
import { FloatingKnowledgeButton } from '@/components/layout/FloatingKnowledgeButton';
import { ProjectGrid } from '@/components/projects/ProjectGrid';
import { ProjectFilters } from '@/components/projects/ProjectFilters';
import { CreateProjectModal } from '@/components/modals/CreateProjectModal';

export default function ProjectsPage() {
  const { isLoggedIn, isLoading } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.push('/');
      return;
    }
    if (isLoggedIn) {
      loadProjects();
    }
  }, [isLoggedIn, isLoading, router]);

  const loadProjects = async (search?: string) => {
    const data = await getProjects(search);
    setProjects(data);
  };

  const handleCreate = async (name: string, ratio: string) => {
    // Mock creation - in real app, call API
    const newProject: Project = {
      id: 'proj_' + Date.now(),
      name,
      ratio,
      style: '未设定',
      createdAt: new Date().toISOString(),
      stylePrompt: '',
      analysisModel: 'Gemini 3 Pro',
      imageModel: 'Nano banana pro',
      videoModel: 'Seedance 2.0',
      generalAnalysis: 'pending',
      basicAnalysis: 'pending',
    };
    setProjects(prev => [...prev, newProject]);
  };

  const handleDelete = (id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id));
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">加载中...</div>;
  }

  return (
    <div className="min-h-screen bg-white">
      <TopBar />
      <main className="pt-8 px-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">我的项目</h1>
          <ProjectFilters
            onSearch={loadProjects}
            onReset={() => loadProjects()}
          />
        </div>
        <ProjectGrid
          projects={projects}
          onCreate={() => setShowCreateModal(true)}
          onDelete={handleDelete}
        />
      </main>
      <CreateProjectModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreate}
      />
      <FloatingKnowledgeButton />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/projects/ProjectFilters.tsx src/app/projects/page.tsx
git commit -m "feat: add projects list page with search, create, delete"
```

---

## Task 16: Project Detail Page Components

**Files:**
- Create: `src/components/projects/ProjectInfoPanel.tsx`
- Create: `src/components/projects/ProjectTabs.tsx`
- Create: `src/components/projects/ProjectTabContent.tsx`

- [ ] **Step 1: Write ProjectInfoPanel**

```typescript
'use client';

import { Project } from '@/types';
import { CheckCircle2 } from 'lucide-react';

interface Props {
  project: Project;
}

export function ProjectInfoPanel({ project }: Props) {
  const infoItems = [
    { label: '分辨率', value: project.ratio },
    { label: '风格', value: project.style },
    { label: '创建时间', value: new Date(project.createdAt).toLocaleString('zh-CN') },
    { label: '分析模型', value: project.analysisModel },
    { label: '图像模型', value: project.imageModel },
    { label: '视频模型', value: project.videoModel },
  ];

  return (
    <div className="w-[300px] flex-shrink-0">
      <h2 className="text-xl font-bold mb-6">{project.name}</h2>

      <div className="space-y-4">
        {infoItems.map(item => (
          <div key={item.label}>
            <div className="text-xs text-[var(--color-text-secondary)] mb-1">{item.label}</div>
            <div className="text-sm font-medium">{item.value}</div>
          </div>
        ))}

        {/* Style prompt */}
        <div>
          <div className="text-xs text-[var(--color-text-secondary)] mb-1">风格提示词</div>
          <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed max-h-40 overflow-y-auto">
            {project.stylePrompt || '暂无'}
          </div>
        </div>

        {/* Analysis status */}
        <div className="pt-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm">通用分析</span>
            {project.generalAnalysis === 'completed' ? (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)] bg-green-50 px-2 py-1 rounded-full">
                <CheckCircle2 className="w-3 h-3" />
                已完成
              </span>
            ) : (
              <span className="text-xs text-gray-400">进行中</span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">基础分析</span>
            {project.basicAnalysis === 'completed' ? (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)] bg-green-50 px-2 py-1 rounded-full">
                <CheckCircle2 className="w-3 h-3" />
                已完成
              </span>
            ) : (
              <span className="text-xs text-gray-400">进行中</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write ProjectTabs**

```typescript
'use client';

import { ProjectTab } from '@/types';
import { PROJECT_TABS } from '@/lib/constants';

interface Props {
  activeTab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
}

export function ProjectTabs({ activeTab, onTabChange }: Props) {
  return (
    <div className="flex items-center gap-1 border-b border-[var(--color-border)]">
      {PROJECT_TABS.map(tab => (
        <button
          key={tab.value}
          onClick={() => onTabChange(tab.value)}
          className={`px-4 py-3 text-sm font-medium transition-colors relative ${
            activeTab === tab.value
              ? 'text-[var(--color-primary)]'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
          }`}
        >
          {tab.label}
          {activeTab === tab.value && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-primary)]" />
          )}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write ProjectTabContent**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { ProjectTab } from '@/types';
import { getProjectTabContent } from '@/lib/api';

interface Props {
  projectId: string;
  tab: ProjectTab;
}

export function ProjectTabContent({ projectId, tab }: Props) {
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    getProjectTabContent(projectId, tab).then(data => {
      setContent(data.content);
      setIsLoading(false);
    });
  }, [projectId, tab]);

  if (isLoading) {
    return <div className="p-8 text-center text-[var(--color-text-secondary)]">加载中...</div>;
  }

  return (
    <div className="p-6">
      <div className="prose max-w-none whitespace-pre-wrap leading-relaxed text-[var(--color-text)]">
        {content}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/projects/ProjectInfoPanel.tsx src/components/projects/ProjectTabs.tsx src/components/projects/ProjectTabContent.tsx
git commit -m "feat: add project detail components (info panel, tabs, content)"
```

---

## Task 17: Project Detail Page

**Files:**
- Create: `src/app/projects/[id]/page.tsx`

- [ ] **Step 1: Write Project Detail page**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Project, ProjectTab } from '@/types';
import { getProject } from '@/lib/api';
import { TopBar } from '@/components/layout/TopBar';
import { FloatingKnowledgeButton } from '@/components/layout/FloatingKnowledgeButton';
import { ProjectInfoPanel } from '@/components/projects/ProjectInfoPanel';
import { ProjectTabs } from '@/components/projects/ProjectTabs';
import { ProjectTabContent } from '@/components/projects/ProjectTabContent';
import { ArrowLeft } from 'lucide-react';

export default function ProjectDetailPage() {
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectTab>('info');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !isLoggedIn) {
      router.push('/');
      return;
    }
    if (isLoggedIn && params.id) {
      loadProject(params.id as string);
    }
  }, [isLoggedIn, authLoading, params.id, router]);

  const loadProject = async (id: string) => {
    setIsLoading(true);
    const data = await getProject(id);
    setProject(data);
    setIsLoading(false);
  };

  if (authLoading || isLoading) {
    return <div className="min-h-screen flex items-center justify-center">加载中...</div>;
  }

  if (!project) {
    return <div className="min-h-screen flex items-center justify-center">项目不存在</div>;
  }

  return (
    <div className="min-h-screen bg-white">
      <TopBar />
      <main className="pt-4 px-8">
        {/* Back button */}
        <button
          onClick={() => router.push('/projects')}
          className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>返回</span>
        </button>

        <div className="flex gap-8">
          {/* Left panel */}
          <ProjectInfoPanel project={project} />

          {/* Right content */}
          <div className="flex-1 min-w-0">
            <ProjectTabs activeTab={activeTab} onTabChange={setActiveTab} />
            <ProjectTabContent projectId={project.id} tab={activeTab} />
          </div>
        </div>
      </main>
      <FloatingKnowledgeButton />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/projects/\[id\]/page.tsx
git commit -m "feat: add project detail page with tabs and info panel"
```

---

## Task 18: Knowledge Base Components

**Files:**
- Create: `src/components/knowledge/DocSidebar.tsx`
- Create: `src/components/knowledge/DocToolbar.tsx`
- Create: `src/components/knowledge/EmptyState.tsx`

- [ ] **Step 1: Write DocSidebar**

```typescript
'use client';

import { useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { KNOWLEDGE_TABS } from '@/lib/constants';

interface Props {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function DocSidebar({ activeTab, onTabChange }: Props) {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="w-[280px] flex-shrink-0 flex flex-col h-full border-r border-[var(--color-border)]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
        <h3 className="font-semibold">
          {KNOWLEDGE_TABS.find(t => t.value === activeTab)?.label}
        </h3>
        <button className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
          <Plus className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Search */}
      <div className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="搜索文档标题"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-[var(--color-border)] text-sm focus:border-[var(--color-primary)] outline-none transition-colors"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pb-2">
        <div className="flex gap-1">
          {KNOWLEDGE_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => onTabChange(tab.value)}
              className={`flex-1 py-1.5 text-xs rounded-lg transition-colors ${
                activeTab === tab.value
                  ? 'bg-gray-100 text-[var(--color-text)] font-medium'
                  : 'text-[var(--color-text-secondary)] hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Document list (empty) */}
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-24 h-24 mb-3 opacity-30">
          <svg viewBox="0 0 96 96" fill="none" className="w-full h-full">
            <rect x="20" y="12" width="56" height="72" rx="4" stroke="currentColor" strokeWidth="2" />
            <line x1="32" y1="32" x2="64" y2="32" stroke="currentColor" strokeWidth="2" />
            <line x1="32" y1="44" x2="64" y2="44" stroke="currentColor" strokeWidth="2" />
            <line x1="32" y1="56" x2="52" y2="56" stroke="currentColor" strokeWidth="2" />
          </svg>
        </div>
        <span className="text-sm text-[var(--color-text-secondary)]">暂无文档</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write DocToolbar**

```typescript
'use client';

import { ArrowLeft, User, Star, FileText } from 'lucide-react';

export function DocToolbar() {
  return (
    <div className="fixed left-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-50">
      <a
        href="/projects"
        className="w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-md border border-[var(--color-border)] hover:shadow-lg transition-shadow"
      >
        <ArrowLeft className="w-4 h-4 text-[var(--color-text)]" />
      </a>
      <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-md border border-[var(--color-border)] hover:shadow-lg transition-shadow">
        <User className="w-4 h-4 text-[var(--color-text)]" />
      </button>
      <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-md border border-[var(--color-border)] hover:shadow-lg transition-shadow">
        <Star className="w-4 h-4 text-[var(--color-text)]" />
      </button>
      <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white shadow-md border border-[var(--color-border)] hover:shadow-lg transition-shadow">
        <FileText className="w-4 h-4 text-[var(--color-text)]" />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write EmptyState**

```typescript
'use client';

export function EmptyState({ message = '暂无文档' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="w-32 h-32 mb-4 opacity-20">
        <svg viewBox="0 0 128 128" fill="none" className="w-full h-full">
          <rect x="24" y="16" width="80" height="96" rx="6" stroke="currentColor" strokeWidth="2" />
          <line x1="40" y1="42" x2="88" y2="42" stroke="currentColor" strokeWidth="2" />
          <line x1="40" y1="58" x2="88" y2="58" stroke="currentColor" strokeWidth="2" />
          <line x1="40" y1="74" x2="72" y2="74" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
      <span className="text-[var(--color-text-secondary)]">{message}</span>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/knowledge/DocSidebar.tsx src/components/knowledge/DocToolbar.tsx src/components/knowledge/EmptyState.tsx
git commit -m "feat: add knowledge base components (sidebar, toolbar, empty state)"
```

---

## Task 19: Knowledge Base Page

**Files:**
- Create: `src/app/knowledge-base/page.tsx`

- [ ] **Step 1: Write Knowledge Base page**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { TopBar } from '@/components/layout/TopBar';
import { DocSidebar } from '@/components/knowledge/DocSidebar';
import { DocToolbar } from '@/components/knowledge/DocToolbar';
import { EmptyState } from '@/components/knowledge/EmptyState';

export default function KnowledgeBasePage() {
  const { isLoggedIn, isLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('created');

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.push('/');
    }
  }, [isLoggedIn, isLoading, router]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">加载中...</div>;
  }

  return (
    <div className="min-h-screen bg-white">
      <TopBar />
      <main className="pt-4 flex h-[calc(100vh-64px)]">
        <DocToolbar />
        <div className="ml-16 flex flex-1">
          <DocSidebar activeTab={activeTab} onTabChange={setActiveTab} />
          <div className="flex-1 bg-[var(--color-bg-sidebar)] rounded-2xl m-4">
            <EmptyState />
          </div>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/knowledge-base/page.tsx
git commit -m "feat: add knowledge base page with sidebar and toolbar"
```

---

## Task 20: Profile Page Components

**Files:**
- Create: `src/components/profile/ProfileForm.tsx`
- Create: `src/app/profile/page.tsx`

- [ ] **Step 1: Write ProfileForm**

```typescript
'use client';

import { useState } from 'react';
import { User } from '@/types';
import { User as UserIcon } from 'lucide-react';

interface Props {
  user: User;
  onSave: (data: Partial<User>) => void;
}

export function ProfileForm({ user, onSave }: Props) {
  const [name, setName] = useState(user.name);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    await onSave({ name });
    setIsSaving(false);
  };

  return (
    <div className="max-w-[600px] mx-auto">
      <h1 className="text-2xl font-bold mb-8">个人主页</h1>

      {/* Avatar */}
      <div className="flex flex-col items-center mb-8">
        <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center mb-3 cursor-pointer hover:bg-gray-200 transition-colors relative group">
          <UserIcon className="w-10 h-10 text-gray-400" />
          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-white text-xs">点击上传</span>
          </div>
        </div>
        <span className="text-xs text-[var(--color-text-secondary)]">支持 JPG/PNG 文件</span>
      </div>

      {/* Form fields */}
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">ID</label>
          <div className="text-sm font-mono bg-gray-50 px-4 py-2.5 rounded-xl">{user.id}</div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">昵称</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">电子邮箱</label>
          <div className="text-base font-semibold">{user.email}</div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">积分</label>
          <div className="text-3xl font-bold">{user.credits}</div>
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full sm:w-auto px-8 py-2.5 bg-[var(--color-primary)] text-white font-medium rounded-xl hover:bg-[var(--color-primary-hover)] disabled:opacity-50 transition-colors"
        >
          {isSaving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write Profile page**

```typescript
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { TopBar } from '@/components/layout/TopBar';
import { FloatingKnowledgeButton } from '@/components/layout/FloatingKnowledgeButton';
import { ProfileForm } from '@/components/profile/ProfileForm';
import { updateProfile } from '@/lib/api';

export default function ProfilePage() {
  const { isLoggedIn, user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.push('/');
    }
  }, [isLoggedIn, isLoading, router]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">加载中...</div>;
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-white">
      <TopBar />
      <main className="pt-8 px-8">
        <ProfileForm user={user} onSave={updateProfile} />
      </main>
      <FloatingKnowledgeButton />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/profile/ProfileForm.tsx src/app/profile/page.tsx
git commit -m "feat: add profile page with avatar and user info form"
```

---

## Task 21: Click-Outside Hook for Menus

**Files:**
- Create: `src/hooks/useClickOutside.ts`

- [ ] **Step 1: Write useClickOutside hook**

```typescript
import { useEffect, RefObject } from 'react';

export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  handler: () => void
) {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        handler();
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [ref, handler]);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useClickOutside.ts
git commit -m "feat: add useClickOutside hook for dropdown menus"
```

---

## Task 22: Final Build & Test

**Files:**
- Modify: Various files for click-outside integration
- Verify: Build passes

- [ ] **Step 1: Add click-outside to TopBar dropdowns**

Update `src/components/layout/TopBar.tsx` to use `useClickOutside` and `useRef`:

```typescript
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
      {/* Brand */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-[var(--color-dark)] flex items-center justify-center">
          <span className="text-white text-xs font-bold">O</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-semibold tracking-tight">Oneness-AI</span>
          <span className="text-xs text-[var(--color-text-secondary)] bg-gray-100 px-1 py-0.5 rounded">.ai</span>
        </div>
      </div>

      {/* Actions */}
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
```

- [ ] **Step 2: Run build**

```bash
cd /home/liuz747/Jobs/oneness-ai
npm run build 2>&1 | tail -20
```

Expected: Build succeeds with 0 errors.

- [ ] **Step 3: Run dev server and smoke test**

```bash
cd /home/liuz747/Jobs/oneness-ai
npm run dev &
sleep 5
curl -s http://localhost:3000 | head -20
echo "---"
curl -s http://localhost:3000/projects | head -5
```

Expected: Server responds with HTML.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Oneness-AI UI clone with all pages and components"
```

---

## Self-Review Checklist

### Spec Coverage
- [x] Home page with particle background — Task 13
- [x] Project list with search/grid — Tasks 14-15
- [x] Project detail with tabs — Tasks 16-17
- [x] Knowledge base with sidebar — Tasks 18-19
- [x] Profile page — Task 20
- [x] TopBar with brand/language/avatar — Task 8
- [x] UserMenuPopover — Task 9
- [x] LoginModal — Task 10
- [x] FloatingKnowledgeButton — Task 11
- [x] CreateProjectModal — Task 12
- [x] AuthContext with localStorage — Task 5
- [x] LocaleContext — Task 6
- [x] API layer with mock data — Task 4
- [x] Type definitions — Task 2
- [x] Route guards — implemented in each page with useAuth + router.push

### Placeholder Scan
- [x] No TBD/TODO/fill in later
- [x] All code blocks contain complete implementations
- [x] All file paths are exact
- [x] All commands include expected output

### Type Consistency
- [x] `User`, `Project`, `ProjectTab`, `KnowledgeDoc`, `Language` types used consistently
- [x] `getProjectTabContent` returns `ProjectTabContent` in Task 4 and consumed in Task 16
- [x] `AuthContext` exports `useAuthContext` consumed by `useAuth` hook
