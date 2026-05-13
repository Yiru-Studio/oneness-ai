'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Project } from '@/types';
import { getProjects } from '@/lib/api';
import { TopBar } from '@/components/layout/TopBar';
import { FloatingKnowledgeButton } from '@/components/layout/FloatingKnowledgeButton';
import { ProjectGrid } from '@/components/projects/ProjectGrid';
import { ProjectFilters } from '@/components/projects/ProjectFilters';
import { CreateProjectModal } from '@/components/modals/CreateProjectModal';

export default function ProjectsPage() {
  const { isLoggedIn, isLoading } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) {
      router.push('/');
      return;
    }
    if (isLoggedIn) {
      loadProjects();
    }
  }, [isLoggedIn, isLoading, router]);

  const loadProjects = async (search?: string) => {
    const data = await getProjects(search);
    setProjects(data);
  };

  const handleCreate = async (name: string, ratio: string) => {
    const newProject: Project = {
      id: 'proj_' + Date.now(),
      name,
      ratio,
      style: '未设定',
      createdAt: new Date().toISOString(),
      stylePrompt: '',
      analysisModel: 'Gemini 3 Pro',
      imageModel: 'Nano banana pro',
      videoModel: 'Seedance 2.0',
      generalAnalysis: 'pending',
      basicAnalysis: 'pending',
    };
    setProjects(prev => [...prev, newProject]);
  };

  const handleDelete = (id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id));
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
