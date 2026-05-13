'use client';

import { StoryboardEpisode } from '@/types';
import { Plus, CheckCircle2 } from 'lucide-react';

interface Props {
  episodes: StoryboardEpisode[];
}

export function StoryboardTabContent({ episodes }: Props) {
  return (
    <div className="p-6">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {/* Episode cards */}
        {episodes.map(ep => (
          <div key={ep.id} className="rounded-xl border border-[var(--color-border)] bg-white p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold">[{ep.number}]</span>
              {ep.analyzed && (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
                  <CheckCircle2 className="w-3 h-3" />
                  已分析
                </span>
              )}
            </div>
            <div className="font-medium mb-2">{ep.title}</div>
            <div className="text-xs text-[var(--color-text-secondary)] line-clamp-4 leading-relaxed">
              {ep.content}
            </div>
          </div>
        ))}

        {/* Add episode card */}
        <button className="aspect-[4/3] rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 hover:border-gray-400 transition-colors bg-[var(--color-bg-card)]">
          <Plus className="w-8 h-8 text-gray-400" />
          <span className="text-sm text-gray-500">添加剧集</span>
        </button>
      </div>
    </div>
  );
}
