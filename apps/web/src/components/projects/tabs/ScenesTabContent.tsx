'use client';

import { Scene } from '@/types';
import { ImagePlus, Plus } from 'lucide-react';

interface Props {
  scenes: Scene[];
}

export function ScenesTabContent({ scenes }: Props) {
  if (scenes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
        正在分析场景…
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
        {/* Add scene card */}
        <button className="aspect-[4/3] rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 hover:border-gray-400 transition-colors bg-[var(--color-bg-card)]">
          <Plus className="w-8 h-8 text-gray-400" />
          <span className="text-sm text-gray-500">添加场景</span>
        </button>

        {/* Scene cards */}
        {scenes.map((scene) => (
          <div key={scene.id} className="rounded-xl overflow-hidden bg-[var(--color-bg-card)]">
            <div className="aspect-[4/3] flex items-center justify-center">
              <ImagePlus className="w-10 h-10 text-gray-400" />
            </div>
            <div className="px-3 py-2 bg-gray-700 text-white text-xs text-center truncate">
              {scene.name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
