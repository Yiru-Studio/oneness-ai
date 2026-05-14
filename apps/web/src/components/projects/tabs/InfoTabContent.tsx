'use client';

import { Project, StoryboardEpisode } from '@/types';
import { CheckCircle2, Pencil } from 'lucide-react';
import { ScriptUploadCard } from '@/components/projects/ScriptUploadCard';

interface Props {
  project: Project;
  episodes: StoryboardEpisode[];
  onEpisodeUploaded: (episode: StoryboardEpisode) => void;
}

export function InfoTabContent({ project, episodes, onEpisodeUploaded }: Props) {
  const infoItems = [
    { label: '分辨率', value: project.ratio },
    { label: '风格', value: project.style },
    { label: '创建时间', value: new Date(project.createdAt).toLocaleString('zh-CN') },
    { label: '分析模型', value: project.analysisModel },
    { label: '图像模型', value: project.imageModel },
    { label: '视频模型', value: project.videoModel },
  ];

  const firstEpisode = episodes[0];

  return (
    <div className="flex gap-8 h-full">
      {/* Left info panel */}
      <div className="w-[300px] flex-shrink-0 overflow-y-auto">
        <div className="flex items-center gap-2 mb-6">
          <h2 className="text-xl font-bold">{project.name}</h2>
          <button className="text-gray-400 hover:text-gray-600">
            <Pencil className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          {infoItems.map((item) => (
            <div key={item.label}>
              <div className="text-xs text-[var(--color-text-secondary)] mb-1">{item.label}</div>
              <div className="text-sm font-medium">{item.value}</div>
            </div>
          ))}

          <div>
            <div className="text-xs text-[var(--color-text-secondary)] mb-1">风格提示词</div>
            <div className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
              {project.stylePrompt || '暂无'}
            </div>
          </div>

          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">通用分析</span>
              {project.generalAnalysis === 'completed' ? (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
                  <CheckCircle2 className="w-3 h-3" />
                  已完成
                </span>
              ) : (
                <span className="text-xs text-gray-400">进行中</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">基础分析</span>
              {project.basicAnalysis === 'completed' ? (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
                  <CheckCircle2 className="w-3 h-3" />
                  已完成
                </span>
              ) : (
                <span className="text-xs text-gray-400">进行中</span>
              )}
            </div>
          </div>
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
