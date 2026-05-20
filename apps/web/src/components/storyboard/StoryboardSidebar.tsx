'use client';

import { ArrowLeft } from 'lucide-react';
import { StoryboardEpisode } from '@/types';

interface Props {
  episode: StoryboardEpisode;
  aiAssistEnabled: boolean;
  onToggleAiAssist: (next: boolean) => void;
  onBack: () => void;
}

/**
 * Left rail of the storyboard episode page — mirrors likeai's `.list-section`.
 * In phase-1 the AI-assist switch is disabled (visible only to surface the
 * future feature). The script preview is read-only.
 */
export function StoryboardSidebar({ episode, aiAssistEnabled, onToggleAiAssist, onBack }: Props) {
  return (
    <aside className="w-[360px] flex-shrink-0 border-r border-[var(--color-border)] bg-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--color-dark)] text-white text-sm hover:opacity-90"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>
        <button
          type="button"
          onClick={() => onToggleAiAssist(!aiAssistEnabled)}
          disabled
          title="AI 辅助模式即将上线"
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium cursor-not-allowed ${
            aiAssistEnabled
              ? 'bg-[var(--color-primary)] text-white'
              : 'bg-gray-100 text-gray-400'
          }`}
        >
          AI 辅助
          <span
            className={`inline-block w-7 h-3.5 rounded-full relative ${
              aiAssistEnabled ? 'bg-white/40' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0 w-3.5 h-3.5 rounded-full bg-white shadow ${
                aiAssistEnabled ? 'right-0' : 'left-0'
              }`}
            />
          </span>
        </button>
      </div>

      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="text-xs text-[var(--color-text-secondary)] mb-1">剧集</div>
        <div className="px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] text-sm">
          【{episode.number}】{episode.title}
        </div>
      </div>

      <div className="px-4 py-3 flex-1 overflow-hidden flex flex-col">
        <div className="text-xs text-[var(--color-text-secondary)] mb-1">剧本内容</div>
        <div className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 text-sm leading-relaxed whitespace-pre-wrap overflow-y-auto font-mono">
          {episode.content || <span className="text-gray-400">（剧集尚未填入剧本）</span>}
        </div>
      </div>
    </aside>
  );
}
