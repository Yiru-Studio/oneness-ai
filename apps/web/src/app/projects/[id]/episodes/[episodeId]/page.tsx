'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  Project,
  Shot,
  Character,
  Item,
  Scene,
  StoryboardEpisode,
} from '@/types';
import {
  getProject,
  getProjectCharacters,
  getProjectItems,
  getProjectScenes,
  getProjectStoryboard,
  getEpisodeShots,
  createShot,
  updateShot,
  deleteShot,
  generateShotVideo,
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
  const [episode, setEpisode] = useState<StoryboardEpisode | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyShot, setBusyShot] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
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
    ])
      .then(([proj, eps, sh, chars, itms, scns]) => {
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
        setEpisode(ep);
        setShots(sh);
        setCharacters(chars);
        setItems(itms);
        setScenes(scns);
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

  // Poll shots while any video task is in flight.
  useEffect(() => {
    const inFlight = shots.some(
      (s) => s.videoTaskStatus === 'QUEUED' || s.videoTaskStatus === 'RUNNING',
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

  const siblingIds = useMemo(() => shots.map((s) => s.displayId), [shots]);

  const handleCreate = async (afterDisplayId?: number) => {
    setCreating(true);
    try {
      await createShot(projectId, episodeId, { afterDisplayId });
      await reloadShots();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建分镜失败');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (id: string, patch: Partial<Shot>) => {
    setBusyShot(id);
    try {
      // Optimistically update local state for snappy feedback.
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

  if (error || !project || !episode) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <div className="text-sm text-red-600">{error ?? '加载失败'}</div>
        <button
          onClick={() => router.push(`/projects/${projectId}`)}
          className="text-sm text-[var(--color-primary)] hover:underline"
        >
          ← 返回项目
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] flex flex-col">
      <TopBar project={project} onProjectUpdated={setProject} />

      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
        <StoryboardSidebar
          episode={episode}
          aiAssistEnabled={false}
          onToggleAiAssist={() => {}}
          onBack={() => router.push(`/projects/${projectId}`)}
        />

        <main className="flex-1 overflow-y-auto px-6 py-4">
          <AnalysisProgressPanel aiAssistEnabled={false} />

          {error && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-500 hover:underline">
                关闭
              </button>
            </div>
          )}

          {shots.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-300 px-6 py-16 text-center">
              <div className="text-sm text-gray-500 mb-3">该剧集还没有分镜</div>
              <button
                onClick={() => handleCreate()}
                disabled={creating}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                创建第 1 个分镜
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {shots.map((shot, idx) => (
                <div key={shot.id}>
                  <ShotCard
                    shot={shot}
                    characters={characters}
                    scenes={scenes}
                    items={items}
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
                  {idx === shots.length - 1 && (
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
