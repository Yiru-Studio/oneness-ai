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
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
        <h3 className="font-semibold">
          {KNOWLEDGE_TABS.find(t => t.value === activeTab)?.label}
        </h3>
        <button className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
          <Plus className="w-4 h-4 text-gray-500" />
        </button>
      </div>

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
