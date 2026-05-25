'use client';

import { useState } from 'react';
import { Project, ProjectTab, StoryboardEpisode } from '@/types';
import { AlertCircle, CheckCircle2, Image, Loader2, Package, Play, Users } from 'lucide-react';
import { ScriptUploadCard } from '@/components/projects/ScriptUploadCard';
import { EditableField } from '@/components/projects/EditableField';
import { updateProject } from '@/lib/api';
import type { UpdateProjectInput } from '@oneness/shared';
import {
  ANALYSIS_MODEL_OPTIONS,
  IMAGE_MODEL_OPTIONS,
  VIDEO_MODEL_OPTIONS,
} from '@/data/style-presets';

interface Props {
  project: Project;
  episodes: StoryboardEpisode[];
  onEpisodeUploaded: (episode: StoryboardEpisode) => void;
  onEpisodeAnalysisRequested: (episode: StoryboardEpisode) => Promise<void>;
  onProjectUpdated: (project: Project) => void;
  onOpenTab: (tab: ProjectTab) => void;
  materialCounts: {
    characters: number;
    scenes: number;
    items: number;
  };
}

const toOption = (m: { modelId: string; label: string }) => ({
  value: m.modelId,
  label: m.label,
});

type AnalysisSubjectState =
  Project['analysisSubjects'][keyof Project['analysisSubjects']];

const MATERIAL_ANALYSIS_ROWS = [
  { key: 'characters', label: '角色解析' },
  { key: 'scenes', label: '场景解析' },
  { key: 'items', label: '道具解析' },
] as const;

export function InfoTabContent({
  project,
  episodes,
  onEpisodeUploaded,
  onEpisodeAnalysisRequested,
  onProjectUpdated,
  onOpenTab,
  materialCounts,
}: Props) {
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const scriptUploaded = episodes.length > 0;
  const firstEpisode = episodes[0];
  const canRequestAnalysis =
    Boolean(firstEpisode) &&
    (project.analysisState === 'idle' || project.analysisState === 'failed');
  const isAnalysisRunning = project.analysisState === 'running' || analysisBusy;
  const analysisCompleted = project.analysisState === 'completed';

  const save = async (patch: UpdateProjectInput) => {
    const updated = await updateProject(project.id, patch);
    onProjectUpdated(updated);
  };

  const handleAnalyze = async () => {
    if (!firstEpisode || !canRequestAnalysis || analysisBusy) return;
    setAnalysisBusy(true);
    setAnalysisError(null);
    try {
      await onEpisodeAnalysisRequested(firstEpisode);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : '启动剧本解析失败');
    } finally {
      setAnalysisBusy(false);
    }
  };

  return (
    <div className="flex gap-8 h-full">
      {/* Left info panel */}
      <div className="w-[300px] flex-shrink-0 overflow-y-auto">
        <div className="flex items-center gap-2 mb-6">
          <h2 className="text-xl font-bold">{project.name}</h2>
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-xs text-[var(--color-text-secondary)] mb-1">分辨率</div>
            <div className="text-sm font-medium">{project.ratio}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-text-secondary)] mb-1">风格</div>
            <div className="text-sm font-medium">{project.style}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-text-secondary)] mb-1">创建时间</div>
            <div className="text-sm font-medium">
              {new Date(project.createdAt).toLocaleString('zh-CN')}
            </div>
          </div>

          <EditableField
            label="风格提示词"
            value={project.stylePrompt}
            onSave={(v) => save({ stylePrompt: v })}
            multiline
          />

          <EditableField
            label="分析模型"
            value={project.analysisModel}
            options={ANALYSIS_MODEL_OPTIONS.map(toOption)}
            onSave={(v) => save({ analysisModel: v })}
          />

          <EditableField
            label="图像模型"
            value={project.imageModel}
            options={IMAGE_MODEL_OPTIONS.map(toOption)}
            onSave={(v) => save({ imageModel: v })}
          />

          <EditableField
            label="视频模型"
            value={project.videoModel}
            options={VIDEO_MODEL_OPTIONS.map(toOption)}
            onSave={(v) => save({ videoModel: v })}
          />

          {scriptUploaded && (
            <div className="pt-2 space-y-3">
              <div>
                <div className="text-sm font-semibold text-[var(--color-text)]">素材解析</div>
                <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                  解析剧本，生成角色、场景和道具素材，用于后续分镜与合成镜头。
                </p>
              </div>

              <div className="space-y-2">
                {MATERIAL_ANALYSIS_ROWS.map((row) => (
                  <AnalysisStatusRow
                    key={row.key}
                    label={row.label}
                    state={project.analysisSubjects[row.key]}
                  />
                ))}
              </div>

              {analysisCompleted && (
                <MaterialAnalysisResult counts={materialCounts} onOpenTab={onOpenTab} />
              )}

              {canRequestAnalysis && !isAnalysisRunning && (
                <button
                  onClick={handleAnalyze}
                  disabled={analysisBusy}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-3 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  {project.analysisState === 'failed'
                    ? '重新解析角色、场景和道具'
                    : '解析角色、场景和道具'}
                </button>
              )}

              {isAnalysisRunning && (
                <div className="flex items-start gap-2 text-xs leading-5 text-blue-600">
                  <Loader2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin" />
                  <span>正在解析剧本素材，完成后会填充角色、场景和道具。</span>
                </div>
              )}

              {analysisError && (
                <div className="flex items-start gap-2 text-xs leading-5 text-red-600">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>{analysisError}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right content area */}
      <div className="flex-1 overflow-y-auto">
        {firstEpisode ? (
          <div className="min-h-full flex flex-col">
            <div className="sticky top-0 z-10 bg-white border-b border-[var(--color-border)] pb-4 mb-4">
              <h3 className="truncate text-lg font-semibold text-[var(--color-text)]">
                {firstEpisode.title}
              </h3>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                剧本已上传，解析会抽取角色、场景和道具，后续用于分镜与合成镜头流程。
              </p>
            </div>
            <div className="prose max-w-none whitespace-pre-wrap leading-relaxed text-[var(--color-text)] text-sm">
              {firstEpisode.content}
            </div>
          </div>
        ) : (
          <ScriptUploadCard projectId={project.id} onUploaded={onEpisodeUploaded} />
        )}
      </div>
    </div>
  );
}

function MaterialAnalysisResult({
  counts,
  onOpenTab,
}: {
  counts: {
    characters: number;
    scenes: number;
    items: number;
  };
  onOpenTab: (tab: ProjectTab) => void;
}) {
  const actions = [
    { label: '查看角色', tab: 'characters', icon: Users },
    { label: '查看场景', tab: 'scenes', icon: Image },
    { label: '查看道具', tab: 'items', icon: Package },
  ] as const;

  return (
    <div className="space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/70 p-3">
      <div className="flex items-start gap-2 text-xs leading-5 text-emerald-700">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        <span>
          已生成 {counts.characters} 个角色、{counts.scenes} 个场景、{counts.items} 个道具
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {actions.map(({ label, tab, icon: Icon }) => (
          <button
            key={tab}
            type="button"
            onClick={() => onOpenTab(tab)}
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-md border border-emerald-200 bg-white px-2 text-xs font-medium text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50"
          >
            <Icon className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AnalysisStatusRow({
  label,
  state,
}: {
  label: string;
  state: AnalysisSubjectState;
}) {
  const meta = analysisStatusMeta(state);
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <span className={`inline-flex items-center gap-1 text-xs ${meta.className}`}>
        {meta.icon}
        {meta.label}
      </span>
    </div>
  );
}

function analysisStatusMeta(state: AnalysisSubjectState) {
  if (state === 'completed') {
    return {
      label: '已完成',
      className: 'text-[var(--color-success)]',
      icon: <CheckCircle2 className="w-3 h-3" />,
    };
  }
  if (state === 'running') {
    return {
      label: '解析中',
      className: 'text-blue-600',
      icon: <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />,
    };
  }
  if (state === 'failed') {
    return {
      label: '失败可重试',
      className: 'text-red-600',
      icon: <AlertCircle className="w-3 h-3" />,
    };
  }
  return {
    label: '未开始',
    className: 'text-gray-400',
    icon: <span className="inline-block w-2 h-2 rounded-full bg-gray-300" />,
  };
}
