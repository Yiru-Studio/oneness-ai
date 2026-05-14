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

      <div className="flex flex-col items-center mb-8">
        <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center mb-3 cursor-pointer hover:bg-gray-200 transition-colors relative group">
          <UserIcon className="w-10 h-10 text-gray-400" />
          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-white text-xs">点击上传</span>
          </div>
        </div>
        <span className="text-xs text-[var(--color-text-secondary)]">支持 JPG/PNG 文件</span>
      </div>

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
