'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Project, ProjectTab, Character, Item, Scene, StoryboardEpisode, AnalyticsData } from '@/types';
import {
  analyzeEpisode,
  getProject,
  getProjectCharacters,
  getProjectItems,
  getProjectScenes,
  getProjectStoryboard,
  getProjectAnalytics,
} from '@/lib/api';
import { TopBar } from '@/components/layout/TopBar';
import { ProjectNavSidebar } from '@/components/projects/ProjectNavSidebar';
import { GenerationProvider } from '@/contexts/GenerationContext';
import { InfoTabContent } from '@/components/projects/tabs/InfoTabContent';
import { CharactersTabContent } from '@/components/projects/tabs/CharactersTabContent';
import { ItemsTabContent } from '@/components/projects/tabs/ItemsTabContent';
import { ScenesTabContent } from '@/components/projects/tabs/ScenesTabContent';
import { CompositionShotsTabContent } from '@/components/projects/tabs/CompositionShotsTabContent';
import { StoryboardTabContent } from '@/components/projects/tabs/StoryboardTabContent';
import { AnalyticsTabContent } from '@/components/projects/tabs/AnalyticsTabContent';

// Poll cadence for entity refresh while analyses are in flight. Generous —
// the worker stub finishes in ~2s, real provider in ~10s.
const POLL_MS = 2000;
const POLL_TIMEOUT_MS = 90_000;

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
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const refreshEntities = useCallback(async (id: string) => {
    const [proj, chars, itms, scns] = await Promise.all([
      getProject(id),
      getProjectCharacters(id),
      getProjectItems(id),
      getProjectScenes(id),
    ]);
    if (proj) setProject(proj);
    setCharacters(chars);
    setItems(itms);
    setScenes(scns);
    return { proj, chars, itms, scns };
  }, []);

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      const startedAt = Date.now();
      pollTimerRef.current = setInterval(async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          stopPolling();
          return;
        }
        const { proj } = await refreshEntities(id);
        // Stop once the project leaves the active entity-analysis state.
        if (proj && proj.analysisState !== 'running') {
          stopPolling();
        }
      }, POLL_MS);
    },
    [refreshEntities, stopPolling],
  );

  useEffect(() => {
    if (!authLoading && !isLoggedIn) {
      router.push('/');
      return;
    }
    if (!isLoggedIn || !params.id) return;

    const id = params.id as string;
    let cancelled = false;

    Promise.all([
      getProject(id),
      getProjectCharacters(id),
      getProjectItems(id),
      getProjectScenes(id),
      getProjectStoryboard(id),
      getProjectAnalytics(id),
    ]).then(([proj, chars, itms, scns, eps, anal]) => {
      if (cancelled) return;
      setProject(proj);
      setCharacters(chars);
      setItems(itms);
      setScenes(scns);
      setEpisodes(eps);
      setAnalytics(anal);
      setIsLoading(false);
      if (eps.length > 0 && proj?.analysisState === 'running') {
        startPolling(id);
      }
    });

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [isLoggedIn, authLoading, params.id, router, startPolling, stopPolling]);

  const handleEpisodeUploaded = (ep: StoryboardEpisode) => {
    setEpisodes((prev) => [...prev, ep]);
  };

  const handleEpisodeAnalysisRequested = async (ep: StoryboardEpisode) => {
    if (!project) return;
    const currentProject = project;
    setProject({
      ...currentProject,
      analysisStarted: true,
      analysisState: 'running',
      analysisSubjects: {
        characters: 'running',
        scenes: 'running',
        items: 'running',
      },
    });
    try {
      await analyzeEpisode(currentProject.id, ep.id);
      await refreshEntities(currentProject.id);
      startPolling(currentProject.id);
    } catch (error) {
      const fresh = await getProject(currentProject.id);
      setProject(fresh ?? currentProject);
      throw error;
    }
  };

  if (authLoading || isLoading) {
    return <div className="min-h-screen flex items-center justify-center">加载中...</div>;
  }

  if (!project) {
    return <div className="min-h-screen flex items-center justify-center">项目不存在</div>;
  }

  const scriptUploaded = episodes.length > 0;

  return (
    <GenerationProvider>
    <div className="min-h-screen bg-white">
      <TopBar project={project} onProjectUpdated={setProject} />
      <ProjectNavSidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        scriptUploaded={scriptUploaded}
      />

      <main className="ml-16 pt-4 px-8 h-[calc(100vh-64px)]">
        <div className="h-full overflow-hidden">
          {activeTab === 'info' && (
            <InfoTabContent
              project={project}
              episodes={episodes}
              onEpisodeUploaded={handleEpisodeUploaded}
              onEpisodeAnalysisRequested={handleEpisodeAnalysisRequested}
              onProjectUpdated={setProject}
              onOpenTab={setActiveTab}
              materialCounts={{
                characters: characters.length,
                scenes: scenes.length,
                items: items.length,
              }}
            />
          )}
          {activeTab === 'characters' && (
            <CharactersTabContent
              characters={characters}
              project={project}
              scriptContent={episodes[0]?.content}
              onChange={setCharacters}
            />
          )}
          {activeTab === 'items' && (
            <ItemsTabContent
              items={items}
              project={project}
              scriptContent={episodes[0]?.content}
              onChange={setItems}
            />
          )}
          {activeTab === 'scenes' && (
            <ScenesTabContent
              scenes={scenes}
              project={project}
              scriptContent={episodes[0]?.content}
              onChange={setScenes}
            />
          )}
          {activeTab === 'workbench' && (
            <CompositionShotsTabContent
              project={project}
              episodes={episodes}
              characters={characters}
              scenes={scenes}
              items={items}
              onOpenTab={setActiveTab}
            />
          )}
          {activeTab === 'storyboard' && (
            <StoryboardTabContent
              episodes={episodes}
              project={project}
              onChange={setEpisodes}
            />
          )}
          {activeTab === 'analytics' && analytics && <AnalyticsTabContent data={analytics} />}
        </div>
      </main>
    </div>
    </GenerationProvider>
  );
}
