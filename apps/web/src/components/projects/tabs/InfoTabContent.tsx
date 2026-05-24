'use client';

import { useState } from 'react';
import { Project, StoryboardEpisode } from '@/types';
import { AlertCircle, CheckCircle2, Loader2, Play } from 'lucide-react';
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
}

const toOption = (m: { modelId: string; label: string }) => ({
  value: m.modelId,
  label: m.label,
});

export function InfoTabContent({
  project,
  episodes,
  onEpisodeUploaded,
  onEpisodeAnalysisRequested,
  onProjectUpdated,
}: Props) {
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const scriptUploaded = episodes.length > 0;
  const firstEpisode = episodes[0];
  const canRequestAnalysis =
    Boolean(firstEpisode) &&
    (project.analysisState === 'idle' || project.analysisState === 'failed');

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
              <div className="space-y-2">
                <AnalysisStatusRow
                  label="通用分析"
                  status={project.generalAnalysis}
                  analysisState={project.analysisState}
                />
                <AnalysisStatusRow
                  label="基础分析"
                  status={project.basicAnalysis}
                  analysisState={project.analysisState}
                />
              </div>

              {canRequestAnalysis && (
                <button
                  onClick={handleAnalyze}
                  disabled={analysisBusy}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-3 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
                >
                  {analysisBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {analysisBusy
                    ? '启动中...'
                    : project.analysisState === 'failed'
                      ? '重新解析剧本'
                      : '开始解析剧本'}
                </button>
              )}

              {project.analysisState === 'running' && (
                <div className="flex items-start gap-2 text-xs leading-5 text-blue-600">
                  <Loader2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin" />
                  <span>正在解析剧本，完成后会自动刷新角色、场景和道具。</span>
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

function AnalysisStatusRow({
  label,
  status,
  analysisState,
}: {
  label: string;
  status: 'pending' | 'completed';
  analysisState: Project['analysisState'];
}) {
  const meta = analysisStatusMeta(status, analysisState);
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

function analysisStatusMeta(
  status: 'pending' | 'completed',
  analysisState: Project['analysisState'],
) {
  if (status === 'completed' || analysisState === 'completed') {
    return {
      label: '已完成',
      className: 'text-[var(--color-success)]',
      icon: <CheckCircle2 className="w-3 h-3" />,
    };
  }
  if (analysisState === 'running') {
    return {
      label: '分析中',
      className: 'text-blue-600',
      icon: <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />,
    };
  }
  if (analysisState === 'failed') {
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
