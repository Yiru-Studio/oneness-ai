'use client';

import { Project } from '@/types';
import { ProjectCard } from './ProjectCard';

interface Props {
  projects: Project[];
  onCreate: () => void;
  onDelete: (id: string) => void;
}

export function ProjectGrid({ projects, onCreate, onDelete }: Props) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(352px,1fr))] gap-6">
      <ProjectCard isCreateCard onCreate={onCreate} />
      {projects.map(project => (
        <ProjectCard key={project.id} project={project} onDelete={onDelete} />
      ))}
    </div>
  );
}
