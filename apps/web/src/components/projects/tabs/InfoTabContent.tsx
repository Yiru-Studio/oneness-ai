'use client';

import { Project, StoryboardEpisode } from '@/types';
import { CheckCircle2 } from 'lucide-react';
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
  onProjectUpdated,
}: Props) {
  const scriptUploaded = episodes.length > 0;
  const firstEpisode = episodes[0];

  const save = async (patch: UpdateProjectInput) => {
    const updated = await updateProject(project.id, patch);
    onProjectUpdated(updated);
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
            <div className="pt-2 space-y-2">
              <AnalysisStatusRow label="通用分析" status={project.generalAnalysis} />
              <AnalysisStatusRow label="基础分析" status={project.basicAnalysis} />
            </div>
          )}
        </div>
      </div>

      {/* Right content area */}
      <div className="flex-1 overflow-y-auto">
        {firstEpisode ? (
          <div className="prose max-w-none whitespace-pre-wrap leading-relaxed text-[var(--color-text)] text-sm">
            {firstEpisode.content}
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
}: {
  label: string;
  status: 'pending' | 'completed';
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      {status === 'completed' ? (
        <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
          <CheckCircle2 className="w-3 h-3" />
          已完成
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          分析中
        </span>
      )}
    </div>
  );
}
