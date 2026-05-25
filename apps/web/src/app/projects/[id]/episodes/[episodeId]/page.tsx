'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, Plus, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  Project,
  Shot,
  Character,
  Item,
  Scene,
  CompositionTask,
  StoryboardEpisode,
} from '@/types';
import {
  getProject,
  getProjectCharacters,
  getProjectItems,
  getProjectScenes,
  getProjectStoryboard,
  getCompositionTasks,
  getEpisodeShots,
  createShot,
  updateShot,
  deleteShot,
  generateShotVideo,
  generateSceneShots,
  generateShotSketches,
  pollTaskUntilDone,
} from '@/lib/api';
import { TopBar } from '@/components/layout/TopBar';
import { StoryboardSidebar } from '@/components/storyboard/StoryboardSidebar';
import { AnalysisProgressPanel } from '@/components/storyboard/AnalysisProgressPanel';
import { ShotCard } from '@/components/storyboard/ShotCard';
import { InsertSeparator } from '@/components/storyboard/InsertSeparator';

// While any shot has a QUEUED/RUNNING video task, we poll the list at this
// cadence so the user sees the video appear when it completes.
const POLL_MS = 3000;

export default function StoryboardEpisodePage() {
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;
  const episodeId = params.episodeId as string;

  const [project, setProject] = useState<Project | null>(null);
  const [episodes, setEpisodes] = useState<StoryboardEpisode[]>([]);
  const [episode, setEpisode] = useState<StoryboardEpisode | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [compositionTasks, setCompositionTasks] = useState<CompositionTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyShot, setBusyShot] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [aiAssistEnabled, setAiAssistEnabled] = useState(true);
  const [assistBusy, setAssistBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reloadShots = useCallback(async () => {
    const fresh = await getEpisodeShots(projectId, episodeId);
    setShots(fresh);
    return fresh;
  }, [projectId, episodeId]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Bootstrap
  useEffect(() => {
    if (!authLoading && !isLoggedIn) {
      router.push('/');
      return;
    }
    if (!isLoggedIn || !projectId || !episodeId) return;
    let cancelled = false;

    Promise.all([
      getProject(projectId),
      getProjectStoryboard(projectId),
      getEpisodeShots(projectId, episodeId),
      getProjectCharacters(projectId),
      getProjectItems(projectId),
      getProjectScenes(projectId),
      getCompositionTasks(projectId),
    ])
      .then(([proj, eps, sh, chars, itms, scns, comps]) => {
        if (cancelled) return;
        if (!proj) {
          setError('项目不存在');
          setIsLoading(false);
          return;
        }
        const ep = eps.find((e) => e.id === episodeId);
        if (!ep) {
          setError('剧集不存在');
          setIsLoading(false);
          return;
        }
        setProject(proj);
        setEpisodes(eps);
        setEpisode(ep);
        setShots(sh);
        setCharacters(chars);
        setItems(itms);
        setScenes(scns);
        setCompositionTasks(comps);
        setIsLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : '加载失败');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [authLoading, isLoggedIn, projectId, episodeId, router, stopPolling]);

  // Poll shots while any sketch or video task is in flight.
  useEffect(() => {
    const inFlight = shots.some(
      (s) =>
        s.videoTaskStatus === 'QUEUED' ||
        s.videoTaskStatus === 'RUNNING' ||
        s.sketchTaskStatus === 'QUEUED' ||
        s.sketchTaskStatus === 'RUNNING',
    );
    if (inFlight && !pollRef.current) {
      pollRef.current = setInterval(() => {
        reloadShots().catch(() => {});
      }, POLL_MS);
    } else if (!inFlight && pollRef.current) {
      stopPolling();
    }
    return () => {};
  }, [shots, reloadShots, stopPolling]);

  const episodeScenes = episode?.scenes ?? [];
  const selectedScene = episodeScenes.find((s) => s.index === sceneIndex) ?? null;

  // Shots scoped to the selected scene.
  const sceneShots = useMemo(
    () => shots.filter((s) => s.sceneIndex === sceneIndex),
    [shots, sceneIndex],
  );
  const siblingIds = useMemo(() => sceneShots.map((s) => s.displayId), [sceneShots]);
  const sketchStatus = useMemo(() => {
    if (sceneShots.some((s) => s.sketchTaskStatus === 'QUEUED' || s.sketchTaskStatus === 'RUNNING')) {
      return 'running';
    }
    if (sceneShots.length > 0 && sceneShots.every((s) => Boolean(s.sketch))) {
      return 'done';
    }
    if (sceneShots.some((s) => s.sketchTaskStatus === 'FAILED' && !s.sketch)) {
      return 'failed';
    }
    return 'idle';
  }, [sceneShots]);

  const handleCreate = async (afterDisplayId?: number) => {
    setCreating(true);
    try {
      // Inherit the project's aspect ratio; 音画同出 defaults on (schema).
      await createShot(projectId, episodeId, { afterDisplayId, sceneIndex, ratio: project?.ratio });
      await reloadShots();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建分镜失败');
    } finally {
      setCreating(false);
    }
  };

  const handleGenerateShots = async () => {
    setAssistBusy(true);
    setError(null);
    try {
      const task = await generateSceneShots(projectId, episodeId, sceneIndex);
      const done = await pollTaskUntilDone(task.id, { intervalMs: 2000, timeoutMs: 4 * 60_000 });
      if (done.status !== 'SUCCEEDED') {
        throw new Error(done.error || '智能分镜生成失败');
      }
      await reloadShots();
      try {
        await generateShotSketches(projectId, { episodeId, sceneIndex });
        setCompositionTasks(await getCompositionTasks(projectId));
        await reloadShots();
      } catch (sketchError) {
        setError(
          `分镜已生成，但合成镜头图生成失败：${
            sketchError instanceof Error ? sketchError.message : '请稍后重试'
          }`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '智能分镜生成失败');
    } finally {
      setAssistBusy(false);
    }
  };

  const handleUpdate = async (id: string, patch: Partial<Shot>) => {
    setBusyShot(id);
    try {
      setShots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
      await updateShot(id, patch);
      await reloadShots();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
      await reloadShots();
    } finally {
      setBusyShot(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该分镜？此操作不可撤销。')) return;
    setBusyShot(id);
    try {
      await deleteShot(id);
      await reloadShots();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除分镜失败');
    } finally {
      setBusyShot(null);
    }
  };

  const handleGenerate = async (id: string) => {
    setBusyShot(id);
    try {
      const next = await generateShotVideo(id);
      setShots((prev) => prev.map((s) => (s.id === id ? next : s)));
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成视频失败');
    } finally {
      setBusyShot(null);
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error && (!project || !episode)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <div className="text-sm text-red-600">{error}</div>
        <button
          onClick={() => router.push(`/projects/${projectId}`)}
          className="text-sm text-[var(--color-primary)] hover:underline"
        >
          ← 返回项目
        </button>
      </div>
    );
  }

  if (!project || !episode) return null;

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col">
      <TopBar project={project} onProjectUpdated={setProject} />

      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
        <StoryboardSidebar
          episodes={episodes}
          episodeId={episodeId}
          scenes={episodeScenes}
          sceneIndex={sceneIndex}
          aiAssistEnabled={aiAssistEnabled}
          onEpisodeChange={(id) => router.push(`/projects/${projectId}/episodes/${id}`)}
          onSceneChange={(idx) => setSceneIndex(idx)}
          onToggleAiAssist={setAiAssistEnabled}
          onBack={() => router.push(`/projects/${projectId}`)}
        />

        <main className="flex-1 overflow-y-auto px-6 py-4">
          <AnalysisProgressPanel
            aiAssistEnabled={aiAssistEnabled}
            scenes={episodeScenes}
            selectedScene={selectedScene}
            sceneShotCount={sceneShots.length}
            batchStatus={assistBusy ? 'running' : 'idle'}
            sketchStatus={sketchStatus}
            onGenerate={handleGenerateShots}
          />

          {error && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-500 hover:underline">
                关闭
              </button>
            </div>
          )}

          {sceneShots.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-300 px-6 py-16 text-center">
              <div className="text-sm text-gray-500 mb-4">
                {selectedScene ? `「${selectedScene.title}」还没有分镜` : '该剧集还没有分镜'}
              </div>
              <div className="flex items-center justify-center gap-3">
                {aiAssistEnabled && episodeScenes.length > 0 && (
                  <button
                    onClick={handleGenerateShots}
                    disabled={assistBusy}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
                  >
                    {assistBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {assistBusy ? '智能生成中…' : '智能分镜创作'}
                  </button>
                )}
                <button
                  onClick={() => handleCreate()}
                  disabled={creating}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm text-gray-700 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  手动创建分镜
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {sceneShots.map((shot, idx) => (
                <div key={shot.id}>
                  <ShotCard
                    shot={shot}
                    characters={characters}
                    scenes={scenes}
                    items={items}
                    compositionTasks={compositionTasks}
                    siblingDisplayIds={siblingIds}
                    busy={busyShot === shot.id}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                    onGenerate={handleGenerate}
                  />
                  <InsertSeparator
                    onInsert={() => handleCreate(shot.displayId)}
                    disabled={creating}
                  />
                  {idx === sceneShots.length - 1 && (
                    <div className="flex justify-center mt-2">
                      <button
                        onClick={() => handleCreate()}
                        disabled={creating}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] disabled:opacity-50"
                      >
                        {creating ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Plus className="w-3.5 h-3.5" />
                        )}
                        添加分镜
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
