'use client';

import { CheckCircle2, Circle, Loader2, Sparkles, RotateCcw } from 'lucide-react';
import { EpisodeScene } from '@/types';

interface Props {
  /** Whether the AI-assist switch is on. When off, the panel is hidden. */
  aiAssistEnabled: boolean;
  /** All analyzed scenes of the episode (from 分析剧集). */
  scenes: EpisodeScene[];
  /** Scene the user is currently storyboarding. */
  selectedScene: EpisodeScene | null;
  /** Number of shots already created for the selected scene. */
  sceneShotCount: number;
  /** Batch-generation lifecycle for the selected scene. */
  batchStatus: 'idle' | 'running' | 'done';
  /** Shot-level composition sketch generation lifecycle for the selected scene. */
  sketchStatus: 'idle' | 'running' | 'done' | 'failed';
  /** Triggers AI-assist shot generation for the selected scene. */
  onGenerate: () => void;
}

/**
 * Mirrors likeai's 4-step AI-assist progress panel. We implement the first two
 * steps from text analysis and the third step from Shot-level sketch tasks.
 */
export function AnalysisProgressPanel({
  aiAssistEnabled,
  scenes,
  selectedScene,
  sceneShotCount,
  batchStatus,
  sketchStatus,
  onGenerate,
}: Props) {
  if (!aiAssistEnabled) return null;

  const sceneListDone = scenes.length > 0;
  const batchDone = batchStatus === 'done' || (batchStatus === 'idle' && sceneShotCount > 0);

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 mb-4 space-y-1">
      {/* Step 1 — scene-list analysis */}
      <Row done={sceneListDone} label="场景列表分析">
        {sceneListDone ? (
          <div className="flex flex-wrap gap-1.5 justify-end max-w-[60%]">
            {scenes.slice(0, 6).map((s) => (
              <span
                key={s.index}
                className={`px-2 py-0.5 rounded-md text-xs whitespace-nowrap ${
                  selectedScene?.index === s.index
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'bg-blue-50 text-blue-600'
                }`}
                title={s.title}
              >
                {truncate(s.title, 14)}
              </span>
            ))}
            {scenes.length > 6 && (
              <span className="px-2 py-0.5 text-xs text-gray-400">+{scenes.length - 6}</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-400">待分析剧集</span>
        )}
      </Row>

      {/* Step 2 — batch shot generation */}
      <Row done={batchDone} running={batchStatus === 'running'} label="批量分镜生成">
        {batchStatus === 'running' ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-primary)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            生成中…
          </span>
        ) : (
          <div className="flex items-center gap-2">
            {sceneShotCount > 0 && (
              <span className="text-xs text-gray-500">本场景 {sceneShotCount} 个分镜</span>
            )}
            <button
              onClick={onGenerate}
              disabled={!selectedScene}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {sceneShotCount > 0 ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  重新生成
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  智能分镜创作
                </>
              )}
            </button>
          </div>
        )}
      </Row>

      <Row done={sketchStatus === 'done'} running={sketchStatus === 'running'} label="生成合成镜头图">
        {sketchStatus === 'running' ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-primary)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            生成中…
          </span>
        ) : sketchStatus === 'done' ? (
          <span className="text-xs text-gray-500">已写入 Shot 参考图</span>
        ) : sketchStatus === 'failed' ? (
          <span className="text-xs text-red-500">生成失败</span>
        ) : (
          <span className="text-xs text-gray-400">等待分镜生成</span>
        )}
      </Row>
      <Row done={sketchStatus === 'done'} label="接入视频参考">
        <span className="text-xs text-gray-500">
          {sketchStatus === 'done' ? '可生成视频' : '等待参考图'}
        </span>
      </Row>
    </div>
  );
}

function Row({
  done,
  running,
  label,
  dim,
  children,
}: {
  done: boolean;
  running?: boolean;
  label: string;
  dim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex items-center gap-3 py-2 ${dim ? 'opacity-50' : ''}`}>
      {running ? (
        <Loader2 className="w-5 h-5 text-[var(--color-primary)] animate-spin flex-shrink-0" />
      ) : done ? (
        <CheckCircle2 className="w-5 h-5 text-[var(--color-success)] flex-shrink-0" />
      ) : (
        <Circle className="w-5 h-5 text-gray-300 flex-shrink-0" />
      )}
      <span className="text-sm text-[var(--color-text)] flex-shrink-0">{label}</span>
      <div className="ml-auto">{children}</div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
