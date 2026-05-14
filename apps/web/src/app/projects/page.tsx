'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Project } from '@/types';
import { createProject, deleteProject, getProjects } from '@/lib/api';
import { TopBar } from '@/components/layout/TopBar';
import { FloatingKnowledgeButton } from '@/components/layout/FloatingKnowledgeButton';
import { ProjectGrid } from '@/components/projects/ProjectGrid';
import { ProjectFilters } from '@/components/projects/ProjectFilters';
import {
  CreateProjectModal,
  type CreateProjectPayload,
} from '@/components/modals/CreateProjectModal';
import {
  DEFAULT_ANALYSIS_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
} from '@/data/style-presets';

export default function ProjectsPage() {
  const { isLoggedIn, isLoading } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const loadProjects = async (search?: string) => {
    const data = await getProjects(search);
    setProjects(data);
  };

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.push('/');
      return;
    }
    if (!isLoggedIn) return;
    let cancelled = false;
    getProjects().then((data) => {
      if (!cancelled) setProjects(data);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, isLoading, router]);

  const handleCreate = async (payload: CreateProjectPayload) => {
    const created = await createProject({
      name: payload.name,
      ratio: payload.ratio,
      style: payload.styleLabel,
      stylePrompt: payload.stylePrompt,
      analysisModel: DEFAULT_ANALYSIS_MODEL,
      imageModel: DEFAULT_IMAGE_MODEL,
      videoModel: DEFAULT_VIDEO_MODEL,
      generalAnalysis: 'PENDING',
      basicAnalysis: 'PENDING',
    });
    router.push(`/projects/${created.id}`);
  };

  const handleDelete = async (id: string) => {
    await deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">加载中...</div>;
  }

  return (
    <div className="min-h-screen bg-white">
      <TopBar />
      <main className="pt-8 px-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">我的项目</h1>
          <ProjectFilters
            onSearch={loadProjects}
            onReset={() => loadProjects()}
          />
        </div>
        <ProjectGrid
          projects={projects}
          onCreate={() => setShowCreateModal(true)}
          onDelete={handleDelete}
        />
      </main>
      <CreateProjectModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreate={handleCreate}
      />
      <FloatingKnowledgeButton />
    </div>
  );
}
