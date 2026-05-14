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
