'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Grid3X3,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  RefreshCcw,
  Trash2,
  X,
} from 'lucide-react';
import { Character, CompositionCandidate, CompositionTask, CompositionTaskRuns, Item, Project, Scene, Shot, ShotAssetRef } from '@/types';
import {
  generateShotSketch,
  getCompositionTaskRuns,
  setShotSketch,
} from '@/lib/api';

type ExistingImage = {
  id: string;
  assetId: string;
  url: string;
  label: string;
  sublabel: string;
  selected?: boolean;
};

interface Props {
  open: boolean;
  onClose: () => void;
  project: Project;
  shot: Shot;
  characters: Character[];
  scenes: Scene[];
  items: Item[];
  compositionTasks: CompositionTask[];
  busy: boolean;
  onError: (message: string) => void;
  onRefreshShots: () => Promise<Shot[]>;
  onRefreshCompositionTasks: () => Promise<CompositionTask[]>;
}

export function ShotSketchDrawer({
  open,
  onClose,
  project,
  shot,
  characters,
  scenes,
  items,
  compositionTasks,
  busy,
  onError,
  onRefreshShots,
  onRefreshCompositionTasks,
}: Props) {
  const [tab, setTab] = useState<'scene' | 'candidates'>('scene');
  const [runs, setRuns] = useState<CompositionTaskRuns | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [loadedTaskId, setLoadedTaskId] = useState<string | null>(null);

  const compositionTask = useMemo(
    () =>
      compositionTasks.find(
        (task) => task.episodeId === shot.episodeId && task.sceneIndex === shot.sceneIndex,
      ) ?? null,
    [compositionTasks, shot.episodeId, shot.sceneIndex],
  );
  const isGenerating = shot.sketchTaskStatus === 'QUEUED' || shot.sketchTaskStatus === 'RUNNING';
  const sketchFailed = shot.sketchTaskStatus === 'FAILED' && !shot.sketch;
  const disabled = busy || localBusy || isGenerating;
  const referenceCount = useMemo(
    () => estimateReferenceCount(shot, compositionTask, characters, scenes, items),
    [shot, compositionTask, characters, scenes, items],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function loadRuns(taskId: string) {
      setRunsLoading(true);
      try {
        const next = await getCompositionTaskRuns(taskId);
        if (!cancelled) {
          setRuns(next);
          setLoadedTaskId(taskId);
        }
      } catch (error) {
        if (!cancelled) {
          setRuns(null);
          onError(error instanceof Error ? error.message : '加载已有分镜图失败');
        }
      } finally {
        if (!cancelled) setRunsLoading(false);
      }
    }
    if (compositionTask) {
      void loadRuns(compositionTask.id);
    } else {
      setRuns(null);
      setLoadedTaskId(null);
    }
    return () => {
      cancelled = true;
    };
  }, [compositionTask, onError, open]);

  useEffect(() => {
    if (!open) return;
    setRuns(null);
    setLoadedTaskId(null);
  }, [open, shot.id]);

  const sceneImages = useMemo(() => buildSceneImages(runs, compositionTask, shot), [runs, compositionTask, shot]);
  const candidateImages = useMemo(() => buildCandidateImages(runs, compositionTask, shot), [runs, compositionTask, shot]);
  const currentList = tab === 'scene' ? sceneImages : candidateImages;

  const refreshRuns = async (taskId?: string | null) => {
    const targetTaskId = taskId ?? compositionTask?.id ?? loadedTaskId;
    if (!targetTaskId) return;
    setRunsLoading(true);
    try {
      setRuns(await getCompositionTaskRuns(targetTaskId));
      setLoadedTaskId(targetTaskId);
    } catch (error) {
      onError(error instanceof Error ? error.message : '刷新已有图失败');
    } finally {
      setRunsLoading(false);
    }
  };

  const handleGenerate = async () => {
    setLocalBusy(true);
    try {
      const result = await generateShotSketch(project.id, {
        shotId: shot.id,
        force: Boolean(shot.sketch),
      });
      await Promise.all([onRefreshShots(), onRefreshCompositionTasks()]);
      await refreshRuns(result.compositionTaskId);
    } catch (error) {
      onError(error instanceof Error ? error.message : '生成分镜图失败');
    } finally {
      setLocalBusy(false);
    }
  };

  const handleSelect = async (assetId: string) => {
    setLocalBusy(true);
    try {
      await setShotSketch(shot.id, { assetId });
      await onRefreshShots();
    } catch (error) {
      onError(error instanceof Error ? error.message : '设置主分镜图失败');
    } finally {
      setLocalBusy(false);
    }
  };

  const handleRemove = async () => {
    setLocalBusy(true);
    try {
      await setShotSketch(shot.id, { assetId: null });
      await onRefreshShots();
    } catch (error) {
      onError(error instanceof Error ? error.message : '移除主分镜图失败');
    } finally {
      setLocalBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1900] flex justify-end bg-black/30">
      <button
        type="button"
        className="absolute inset-0"
        onClick={onClose}
        aria-label="关闭分镜图设置"
      />
      <aside className="relative z-10 flex h-full w-full max-w-[720px] flex-col bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-6 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-sm font-semibold text-white">
            {shot.displayId}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">分镜图设置</h2>
            <p className="truncate text-sm text-gray-500">{compositionTask?.title ?? '当前 Shot'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <section className="border-b border-[var(--color-border)] pb-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-900">当前分镜图</h3>
              {shot.sketch ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  已设置
                </span>
              ) : isGenerating ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-[var(--color-primary)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  生成中
                </span>
              ) : sketchFailed ? (
                <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600">
                  生成失败
                </span>
              ) : (
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
                  待选择
                </span>
              )}
            </div>

            <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-gray-50">
              <div className="aspect-video">
                {shot.sketch?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shot.sketch.url} alt="当前分镜图" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-500">
                    {isGenerating ? '正在生成主分镜图…' : '还没有设置主分镜图'}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={disabled || !shot.prompt.trim()}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--color-primary)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
              >
                {localBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {shot.sketch ? '通过提示词重新生成' : '通过提示词生成'}
              </button>
              <button
                type="button"
                onClick={() => void handleRemove()}
                disabled={disabled || !shot.sketch}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--color-border)] px-4 text-sm font-medium text-gray-700 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                移除
              </button>
              <span className="text-xs text-gray-500">
                将使用 {referenceCount} 张参考图
              </span>
            </div>
            {!shot.prompt.trim() && (
              <p className="mt-2 text-xs text-red-500">请先填写 Shot prompt，再通过提示词生成。</p>
            )}
          </section>

          <section className="pt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-900">选择已有图</h3>
              <button
                type="button"
                onClick={() => void refreshRuns()}
                disabled={runsLoading || !compositionTask}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:opacity-50"
              >
                <RefreshCcw className={`h-3.5 w-3.5 ${runsLoading ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>

            <div className="mb-4 inline-flex rounded-full bg-gray-100 p-1">
              <TabButton active={tab === 'scene'} onClick={() => setTab('scene')} icon={<ImageIcon className="h-4 w-4" />}>
                场景图
              </TabButton>
              <TabButton active={tab === 'candidates'} onClick={() => setTab('candidates')} icon={<Grid3X3 className="h-4 w-4" />}>
                分镜候选
              </TabButton>
            </div>

            {runsLoading ? (
              <div className="flex min-h-[240px] items-center justify-center text-sm text-gray-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                加载中…
              </div>
            ) : !compositionTask ? (
              <EmptyState text="还没有生成场景图任务；通过提示词生成时会自动建立当前场景任务。" />
            ) : currentList.length === 0 ? (
              <EmptyState text={tab === 'scene' ? '当前场景还没有可用的场景图。' : '当前场景还没有可用的 3x3 分镜候选。'} />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {currentList.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void handleSelect(item.assetId)}
                    disabled={disabled}
                    className={`group overflow-hidden rounded-lg border bg-white text-left transition-colors hover:border-[var(--color-primary)] disabled:opacity-60 ${
                      item.selected ? 'border-[var(--color-primary)] ring-2 ring-blue-100' : 'border-[var(--color-border)]'
                    }`}
                  >
                    <div className="aspect-video bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.url} alt={item.label} className="h-full w-full object-cover" />
                    </div>
                    <div className="px-3 py-2">
                      <div className="truncate text-sm font-medium text-gray-900">{item.label}</div>
                      <div className="truncate text-xs text-gray-500">{item.sublabel}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium ${
        active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 text-center text-sm text-gray-500">
      {text}
    </div>
  );
}

function buildSceneImages(
  runs: CompositionTaskRuns | null,
  task: CompositionTask | null,
  shot: Shot,
): ExistingImage[] {
  const rows: ExistingImage[] = [];
  if (task?.image?.url) {
    rows.push({
      id: `current-${task.id}`,
      assetId: task.image.id,
      url: task.image.url,
      label: '当前场景图',
      sublabel: task.title,
      selected: shot.sketch?.id === task.image.id,
    });
  }
  for (const run of runs?.imageRuns ?? []) {
    if (!run.image?.url) continue;
    if (rows.some((item) => item.assetId === run.image!.id)) continue;
    rows.push({
      id: run.id,
      assetId: run.image.id,
      url: run.image.url,
      label: run.status === 'SUCCEEDED' ? '场景图历史' : `场景图 ${run.status}`,
      sublabel: formatDate(run.createdAt),
      selected: shot.sketch?.id === run.image.id,
    });
  }
  return rows;
}

function buildCandidateImages(
  runs: CompositionTaskRuns | null,
  task: CompositionTask | null,
  shot: Shot,
): ExistingImage[] {
  const candidates = [
    ...(task?.candidates ?? []),
    ...((runs?.gridRuns ?? []).flatMap((run) => run.candidates)),
  ];
  const rows: ExistingImage[] = [];
  for (const candidate of candidates) {
    const image = candidate.image;
    if (!image?.url) continue;
    if (rows.some((item) => item.assetId === image.id)) continue;
    rows.push(candidateToImage(candidate, image, shot));
  }
  return rows;
}

function candidateToImage(candidate: CompositionCandidate, image: ShotAssetRef, shot: Shot): ExistingImage {
  return {
    id: candidate.id,
    assetId: image.id,
    url: image.url,
    label: `候选 ${candidate.gridIndex}`,
    sublabel: candidate.angleLabel ?? '3x3 分镜候选',
    selected: shot.sketch?.id === image.id,
  };
}

function estimateReferenceCount(
  shot: Shot,
  task: CompositionTask | null,
  characters: Character[],
  scenes: Scene[],
  items: Item[],
): number {
  const assetIds = new Set<string>();
  if (task?.image?.id) assetIds.add(task.image.id);
  const styleIds = new Set([...(shot.characterStyleIds ?? []), ...(task?.characterStyleIds ?? [])]);
  for (const styleId of styleIds) {
    for (const character of characters) {
      const style = character.styles.find((item) => item.id === styleId);
      if (!style) continue;
      if (character.identityAssetId) assetIds.add(character.identityAssetId);
      else if (character.avatarAssetId) assetIds.add(character.avatarAssetId);
      if (style.assetId) assetIds.add(style.assetId);
    }
  }
  for (const sceneId of new Set([...(shot.sceneIds ?? []), ...(task?.sceneIds ?? [])])) {
    const scene = scenes.find((item) => item.id === sceneId);
    if (scene?.assetId) assetIds.add(scene.assetId);
  }
  for (const itemId of new Set([...(shot.itemIds ?? []), ...(task?.itemIds ?? [])])) {
    const item = items.find((entry) => entry.id === itemId);
    if (item?.assetId) assetIds.add(item.assetId);
  }
  return Math.min(assetIds.size, 8);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
