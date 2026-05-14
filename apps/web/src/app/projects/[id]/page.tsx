'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Project, ProjectTab, Character, Item, Scene, StoryboardEpisode, AnalyticsData } from '@/types';
import { getProject, getProjectCharacters, getProjectItems, getProjectScenes, getProjectStoryboard, getProjectAnalytics } from '@/lib/api';
import { TopBar } from '@/components/layout/TopBar';
import { ProjectNavSidebar } from '@/components/projects/ProjectNavSidebar';
import { InfoTabContent } from '@/components/projects/tabs/InfoTabContent';
import { CharactersTabContent } from '@/components/projects/tabs/CharactersTabContent';
import { ItemsTabContent } from '@/components/projects/tabs/ItemsTabContent';
import { ScenesTabContent } from '@/components/projects/tabs/ScenesTabContent';
import { WorkbenchTabContent } from '@/components/projects/tabs/WorkbenchTabContent';
import { StoryboardTabContent } from '@/components/projects/tabs/StoryboardTabContent';
import { AnalyticsTabContent } from '@/components/projects/tabs/AnalyticsTabContent';

export default function ProjectDetailPage() {
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectTab>('info');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [episodes, setEpisodes] = useState<StoryboardEpisode[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !isLoggedIn) {
      router.push('/');
      return;
    }
    if (isLoggedIn && params.id) {
      loadProject(params.id as string);
    }
  }, [isLoggedIn, authLoading, params.id, router]);

  const loadProject = async (id: string) => {
    setIsLoading(true);
    const [proj, chars, itms, scns, eps, anal] = await Promise.all([
      getProject(id),
      getProjectCharacters(id),
      getProjectItems(id),
      getProjectScenes(id),
      getProjectStoryboard(id),
      getProjectAnalytics(id),
    ]);
    setProject(proj);
    setCharacters(chars);
    setItems(itms);
    setScenes(scns);
    setEpisodes(eps);
    setAnalytics(anal);
    setIsLoading(false);
  };

  if (authLoading || isLoading) {
    return <div className="min-h-screen flex items-center justify-center">加载中...</div>;
  }

  if (!project) {
    return <div className="min-h-screen flex items-center justify-center">项目不存在</div>;
  }

  return (
    <div className="min-h-screen bg-white">
      <TopBar />
      <ProjectNavSidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="ml-16 pt-4 px-8 h-[calc(100vh-64px)]">
        <div className="h-full overflow-hidden">
          {activeTab === 'info' && <InfoTabContent project={project} />}
          {activeTab === 'characters' && <CharactersTabContent characters={characters} />}
          {activeTab === 'items' && <ItemsTabContent items={items} />}
          {activeTab === 'scenes' && <ScenesTabContent scenes={scenes} />}
          {activeTab === 'workbench' && <WorkbenchTabContent />}
          {activeTab === 'storyboard' && <StoryboardTabContent episodes={episodes} />}
          {activeTab === 'analytics' && analytics && <AnalyticsTabContent data={analytics} />}
        </div>
      </main>
    </div>
  );
}
