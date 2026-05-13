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

      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-text-secondary)]">积分</span>
          <div className="flex items-center gap-1">
            <span className="font-medium">{user?.credits}</span>
            <ChevronRight className="w-4 h-4 text-[var(--color-text-secondary)]" />
          </div>
        </div>
      </div>

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
