'use client';

import { Project } from '@/types';
import { Video, Plus, Trash2 } from 'lucide-react';

interface ProjectCardProps {
  project?: Project;
  isCreateCard?: boolean;
  onCreate?: () => void;
  onDelete?: (id: string) => void;
}

export function ProjectCard({ project, isCreateCard, onCreate, onDelete }: ProjectCardProps) {
  if (isCreateCard) {
    return (
      <button
        onClick={onCreate}
        className="card card-lg card-cta group flex flex-col items-center justify-center gap-3 bg-[var(--color-bg-card)] rounded-2xl h-[245px] border-2 border-transparent hover:border-gray-300 transition-colors"
      >
        <Plus className="w-10 h-10 text-gray-400 group-hover:text-gray-600 transition-colors" />
        <span className="text-sm font-medium text-gray-500 group-hover:text-gray-700">新建项目</span>
      </button>
    );
  }

  if (!project) return null;

  return (
    <a
      href={`/projects/${project.id}`}
      className="card card-lg card-project group relative flex flex-col bg-[var(--color-bg-card)] rounded-2xl h-[245px] p-6 hover:shadow-md transition-shadow"
    >
      <button
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          onDelete?.(project.id);
        }}
        className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-[var(--color-danger)] hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      <div className="flex-1 flex items-center justify-center">
        <Video className="w-12 h-12 text-gray-400" />
      </div>

      <div className="mt-auto">
        <h3 className="font-semibold text-[var(--color-text)] mb-2">{project.name}</h3>
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          <span className="meta-item">{project.ratio}</span>
          <span className="meta-item">{project.style}</span>
          <ProjectStatusPill project={project} />
        </div>
      </div>
    </a>
  );
}

function ProjectStatusPill({ project }: { project: Project }) {
  const meta = {
    idle: {
      label: '未开始',
      cls: 'bg-gray-50 text-gray-500 border-gray-200',
    },
    running: {
      label: '解析中',
      cls: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    failed: {
      label: '解析失败',
      cls: 'bg-red-50 text-red-700 border-red-200',
    },
    completed: {
      label: '已立项',
      cls: 'bg-green-50 text-green-700 border-green-200',
    },
  }[project.analysisState];

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${meta.cls}`}>
      {meta.label}
    </span>
  );
}
