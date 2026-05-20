'use client';

import { ArrowLeft, ChevronDown } from 'lucide-react';
import { StoryboardEpisode, EpisodeScene } from '@/types';

interface Props {
  episodes: StoryboardEpisode[];
  episodeId: string;
  scenes: EpisodeScene[];
  sceneIndex: number;
  aiAssistEnabled: boolean;
  onEpisodeChange: (episodeId: string) => void;
  onSceneChange: (sceneIndex: number) => void;
  onToggleAiAssist: (next: boolean) => void;
  onBack: () => void;
}

/**
 * Left rail of the storyboard episode page — mirrors likeai's `.list-section`:
 * 返回 + AI辅助 toggle, an episode selector, a scene selector, and the
 * selected scene's script text.
 */
export function StoryboardSidebar({
  episodes,
  episodeId,
  scenes,
  sceneIndex,
  aiAssistEnabled,
  onEpisodeChange,
  onSceneChange,
  onToggleAiAssist,
  onBack,
}: Props) {
  const selectedScene = scenes.find((s) => s.index === sceneIndex) ?? null;

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
          title="AI 辅助模式：自动拆解场景并批量生成分镜"
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            aiAssistEnabled
              ? 'bg-[var(--color-primary)] text-white'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          AI 辅助
          <span className={`inline-block w-7 h-3.5 rounded-full relative ${aiAssistEnabled ? 'bg-white/40' : 'bg-gray-300'}`}>
            <span className={`absolute top-0 w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${aiAssistEnabled ? 'right-0' : 'left-0'}`} />
          </span>
        </button>
      </div>

      {/* Episode selector */}
      <div className="px-4 pt-3">
        <Dropdown
          value={episodeId}
          onChange={onEpisodeChange}
          options={episodes.map((e) => ({ value: e.id, label: `第${e.number}集 · ${e.title}` }))}
        />
      </div>

      {/* Scene selector */}
      <div className="px-4 pt-2 pb-3 border-b border-[var(--color-border)]">
        <Dropdown
          value={String(sceneIndex)}
          onChange={(v) => onSceneChange(Number(v))}
          disabled={scenes.length === 0}
          options={
            scenes.length === 0
              ? [{ value: '0', label: '（暂无场景，请先分析剧集）' }]
              : scenes.map((s) => ({ value: String(s.index), label: `场景 ${s.index + 1} · ${s.title || '未命名'}` }))
          }
        />
      </div>

      <div className="px-4 py-3 flex-1 overflow-hidden flex flex-col">
        <div className="text-xs text-[var(--color-text-secondary)] mb-1">
          {selectedScene ? '本场景剧本' : '剧本内容'}
        </div>
        <div className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 text-sm leading-relaxed whitespace-pre-wrap overflow-y-auto font-mono">
          {selectedScene ? (
            <>
              {selectedScene.environment && (
                <div className="text-xs text-[var(--color-primary)] mb-2 not-italic">
                  🎬 {selectedScene.environment}
                </div>
              )}
              {selectedScene.content || <span className="text-gray-400">（本场景无内容）</span>}
            </>
          ) : (
            <span className="text-gray-400">（剧集尚未分析，点击「分析剧集」拆解场景）</span>
          )}
        </div>
      </div>
    </aside>
  );
}

function Dropdown({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full appearance-none px-3 py-2 pr-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-60 cursor-pointer truncate"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}
