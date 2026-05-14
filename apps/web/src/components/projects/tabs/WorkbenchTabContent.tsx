'use client';

import { Plus, Minus, Maximize, PlusCircle, LayoutGrid, GitBranch } from 'lucide-react';

export function WorkbenchTabContent() {
  return (
    <div className="h-full flex flex-col">
      {/* Top toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--color-border)]">
        <button className="px-4 py-2 text-sm bg-blue-50 text-[var(--color-primary)] rounded-lg hover:bg-blue-100 transition-colors">
          选择画布
        </button>
        <button className="px-4 py-2 text-sm bg-blue-50 text-[var(--color-primary)] rounded-lg hover:bg-blue-100 transition-colors">
          新建画布
        </button>
        <button className="px-4 py-2 text-sm bg-blue-50 text-[var(--color-primary)] rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1.5">
          <GitBranch className="w-3.5 h-3.5" />
          添加节点
        </button>
      </div>

      {/* Canvas area */}
      <div className="flex-1 relative flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-[var(--color-dark)] animate-pulse" />
          <span className="text-sm text-[var(--color-text-secondary)]">画布加载中...</span>
        </div>
      </div>

      {/* Bottom toolbar */}
      <div className="absolute bottom-6 left-20 flex items-center gap-2">
        <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-white shadow-md border border-[var(--color-border)] hover:shadow-lg transition-shadow">
          <Plus className="w-4 h-4" />
        </button>
        <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-white shadow-md border border-[var(--color-border)] hover:shadow-lg transition-shadow">
          <Minus className="w-4 h-4" />
        </button>
        <button className="w-8 h-8 flex items-center justify-center rounded-lg bg-white shadow-md border border-[var(--color-border)] hover:shadow-lg transition-shadow">
          <Maximize className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
