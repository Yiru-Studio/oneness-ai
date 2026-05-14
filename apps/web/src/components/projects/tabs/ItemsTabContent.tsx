'use client';

import { Item } from '@/types';
import { ImagePlus, Plus } from 'lucide-react';

interface Props {
  items: Item[];
}

export function ItemsTabContent({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
        正在分析物品…
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
        {/* Add item card */}
        <button className="aspect-square rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 hover:border-gray-400 transition-colors bg-[var(--color-bg-card)]">
          <Plus className="w-8 h-8 text-gray-400" />
          <span className="text-sm text-gray-500">添加物品</span>
        </button>

        {/* Item cards */}
        {items.map((item) => (
          <div key={item.id} className="rounded-xl overflow-hidden bg-[var(--color-bg-card)]">
            <div className="aspect-square flex items-center justify-center">
              <ImagePlus className="w-10 h-10 text-gray-400" />
            </div>
            <div className="px-3 py-2 bg-gray-700 text-white text-xs text-center">
              {item.name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
