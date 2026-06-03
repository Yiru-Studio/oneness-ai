'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Grid3X3,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Plus,
  RefreshCcw,
  X,
} from 'lucide-react';
import { Character, CompositionCandidate, CompositionTask, CompositionTaskRuns, Item, Project, Scene, Shot, ShotAssetRef } from '@/types';
import {
  generateShotSketch,
  getCompositionTaskRuns,
  getShotSketchContext,
  setShotSketch,
  updateCompositionTask,
  updateShot,
  type ImageGenerationRun,
  type ShotSketchContext,
  type ShotSketchHistoryRun,
  type ShotSketchReferenceAsset,
} from '@/lib/api';
import { IMAGE_MODEL_OPTIONS } from '@/data/style-presets';
import { ImagePreview } from '@/components/ImagePreview';
import { ReferencePickerDialog } from './ReferencePickerDialog';
import { useGeneration, type GenerationKind } from '@/contexts/GenerationContext';
import { isTaskPending, taskPendingLabel } from '@/lib/task-status';
import { useImageGenerationRuns } from '@/hooks/useImageGenerationRuns';

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
  onRefreshReferences: () => Promise<void>;
  onRefreshShots: () => Promise<Shot[]>;
  onRefreshCompositionTasks: () => Promise<CompositionTask[]>;
}

const RATIO_OPTIONS = [
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '1:1', label: '1:1 方形' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];

const SOURCE_LABEL: Record<ShotSketchReferenceAsset['source'], string> = {
  composition: '场景图',
  character: '角色造型',
  scene: '场景素材',
  item: '道具',
};

function generationKindForReference(reference: ShotSketchReferenceAsset): GenerationKind | null {
  if (reference.source === 'character') return 'style';
  if (reference.source === 'scene') return 'scene';
  if (reference.source === 'item') return 'item';
  return null;
}

function referenceRunOwnerKey(reference: ShotSketchReferenceAsset): string | null {
  if (!reference.sourceId) return null;
  if (reference.source === 'character') return `character-style:${reference.sourceId}`;
  if (reference.source === 'scene') return `scene:${reference.sourceId}`;
  if (reference.source === 'item') return `item:${reference.sourceId}`;
  return null;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildShotReferenceRemovalPatch(
  shot: Shot,
  reference: ShotSketchReferenceAsset,
): Partial<Shot> | null {
  if (!reference.sourceId) return null;
  if (reference.source === 'composition') {
    return {
      compositionTaskIds: shot.compositionTaskIds.filter((id) => id !== reference.sourceId),
    };
  }
  if (reference.source === 'character') {
    return {
      characterStyleIds: shot.characterStyleIds.filter((id) => id !== reference.sourceId),
    };
  }
  if (reference.source === 'scene') {
    return {
      sceneIds: shot.sceneIds.filter((id) => id !== reference.sourceId),
    };
  }
  return {
    itemIds: shot.itemIds.filter((id) => id !== reference.sourceId),
  };
}

function buildCompositionTaskReferenceRemovalPatch(
  task: CompositionTask,
  reference: ShotSketchReferenceAsset,
): Parameters<typeof updateCompositionTask>[1] | null {
  if (!reference.sourceId) return null;
  if (reference.source === 'character') {
    return {
      characterStyleIds: task.characterStyleIds.filter((id) => id !== reference.sourceId),
    };
  }
  if (reference.source === 'scene') {
    return {
      sceneIds: task.sceneIds.filter((id) => id !== reference.sourceId),
    };
  }
  if (reference.source === 'item') {
    return {
      itemIds: task.itemIds.filter((id) => id !== reference.sourceId),
    };
  }
  return null;
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
  onRefreshReferences,
  onRefreshShots,
  onRefreshCompositionTasks,
}: Props) {
  const [tab, setTab] = useState<'scene' | 'candidates'>('scene');
  const [context, setContext] = useState<ShotSketchContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [runs, setRuns] = useState<CompositionTaskRuns | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const [generateSubmitting, setGenerateSubmitting] = useState(false);
  const [optimisticSketchTaskId, setOptimisticSketchTaskId] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState(shot.prompt);
  const [model, setModel] = useState(project.imageModel);
  const [ratio, setRatio] = useState(project.ratio);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; label: string } | null>(null);
  const activeContextShotRef = useRef<string | null>(null);
  const { runs: activeImageRuns, byOwner: imageRunByOwner } = useImageGenerationRuns(project.id, {
    activeOnly: true,
    enabled: open,
  });

  const compositionTask = useMemo(
    () =>
      compositionTasks.find(
        (task) => task.episodeId === shot.episodeId && task.sceneIndex === shot.sceneIndex,
      ) ?? null,
    [compositionTasks, shot.episodeId, shot.sceneIndex],
  );
  const isGenerating = isTaskPending(shot.sketchTaskStatus);
  const previewGenerating = generateSubmitting || isGenerating || Boolean(optimisticSketchTaskId);
  const sketchFailed = shot.sketchTaskStatus === 'FAILED' && !shot.sketch;
  const disabled = busy || localBusy || isGenerating;
  const contextTaskId = context?.compositionTaskId ?? compositionTask?.id ?? null;
  const sceneImages = useMemo(() => buildSceneImages(runs, compositionTask, shot), [runs, compositionTask, shot]);
  const candidateImages = useMemo(() => buildCandidateImages(runs, compositionTask, shot), [runs, compositionTask, shot]);
  const currentList = tab === 'scene' ? sceneImages : candidateImages;
  const visibleReferenceAssets = useMemo(
    () => (context?.referenceAssets ?? []).filter((reference) => reference.scope !== 'locked'),
    [context?.referenceAssets],
  );
  const hasPendingReferenceResource = useMemo(
    () => visibleReferenceAssets.some((reference) => {
      const key = referenceRunOwnerKey(reference);
      return isTaskPending((key ? imageRunByOwner.get(key)?.status : null) ?? reference.resourceStatus);
    }),
    [imageRunByOwner, visibleReferenceAssets],
  );
  const referencePickerSelection = useMemo(
    () => ({
      compositionTaskIds: shot.compositionTaskIds,
      characterStyleIds: uniq([
        ...shot.characterStyleIds,
        ...visibleReferenceAssets
          .filter((reference) => reference.source === 'character' && reference.sourceId)
          .map((reference) => reference.sourceId as string),
      ]),
      sceneIds: uniq([
        ...shot.sceneIds,
        ...visibleReferenceAssets
          .filter((reference) => reference.source === 'scene' && reference.sourceId)
          .map((reference) => reference.sourceId as string),
      ]),
      itemIds: uniq([
        ...shot.itemIds,
        ...visibleReferenceAssets
          .filter((reference) => reference.source === 'item' && reference.sourceId)
          .map((reference) => reference.sourceId as string),
      ]),
    }),
    [shot.characterStyleIds, shot.compositionTaskIds, shot.itemIds, shot.sceneIds, visibleReferenceAssets],
  );
  const sketchHistory = useMemo<ShotSketchHistoryRun[]>(() => {
    const history = context?.sketchHistory ?? [];
    if (!shot.sketch || history.some((item) => item.image?.id === shot.sketch?.id)) return history;
    return [
      {
        id: `current-${shot.sketch.id}`,
        source: 'manual',
        status: 'APPLIED',
        error: null,
        taskId: null,
        prompt: '',
        model: null,
        ratio: null,
        referenceAssetIds: [],
        createdAt: shot.updatedAt,
        updatedAt: shot.updatedAt,
        current: true,
        image: shot.sketch,
        sourceImage: shot.sketch,
      },
      ...history,
    ];
  }, [context?.sketchHistory, shot.sketch, shot.updatedAt]);
  const hasPrompt = promptDraft.trim().length > 0;

  const refreshRuns = useCallback(
    async (taskId?: string | null) => {
      const targetTaskId = taskId ?? contextTaskId;
      if (!targetTaskId) return;
      setRunsLoading(true);
      try {
        setRuns(await getCompositionTaskRuns(targetTaskId));
      } catch (error) {
        onError(error instanceof Error ? error.message : '刷新已有图失败');
      } finally {
        setRunsLoading(false);
      }
    },
    [contextTaskId, onError],
  );

  const loadContextAndRuns = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      if (!options.quiet) setContextLoading(true);
      try {
        const nextContext = await getShotSketchContext(project.id, { shotId: shot.id });
        if (activeContextShotRef.current !== shot.id) return;
        setContext(nextContext);
        setPromptDraft((current) => (current === shot.prompt ? nextContext.prompt : current));
        setModel(nextContext.model || project.imageModel);
        setRatio(nextContext.ratio || project.ratio);
        await refreshRuns(nextContext.compositionTaskId);
      } catch (error) {
        onError(error instanceof Error ? error.message : '加载分镜图设置失败');
      } finally {
        if (!options.quiet) setContextLoading(false);
      }
    },
    [onError, project.id, project.imageModel, project.ratio, refreshRuns, shot.id, shot.prompt],
  );

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- Opening a shot drawer initializes owned draft UI state from the selected shot and fetched context. */
    setPromptDraft(shot.prompt);
    setModel(project.imageModel);
    setRatio(project.ratio);
    setTab('scene');
    setRuns(null);
    setContext(null);
    setGenerateSubmitting(false);
    setOptimisticSketchTaskId(null);
    activeContextShotRef.current = shot.id;
    void loadContextAndRuns();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [loadContextAndRuns, open, project.imageModel, project.ratio, shot.id, shot.prompt]);

  useEffect(() => {
    if (
      optimisticSketchTaskId &&
      shot.sketchTaskId === optimisticSketchTaskId &&
      !isTaskPending(shot.sketchTaskStatus)
    ) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Clears a local optimistic marker after server task status catches up.
      setOptimisticSketchTaskId(null);
    }
  }, [optimisticSketchTaskId, shot.sketchTaskId, shot.sketchTaskStatus]);

  useEffect(() => {
    if (!open || !shot.sketch || previewGenerating) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Refreshing external sketch context after an applied image is the effect's synchronization work.
    void loadContextAndRuns({ quiet: true });
  }, [loadContextAndRuns, open, shot.sketch, previewGenerating]);

  useEffect(() => {
    if (!open) return;
    const hasActiveRun = (context?.sketchHistory ?? []).some(
      (run) => isTaskPending(run.status),
    );
    if (!hasActiveRun && !previewGenerating && !hasPendingReferenceResource && activeImageRuns.length === 0) return;
    const timer = window.setInterval(() => {
      void loadContextAndRuns({ quiet: true });
      void onRefreshShots().catch(() => {});
      void onRefreshReferences().catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeImageRuns.length, hasPendingReferenceResource, loadContextAndRuns, onRefreshReferences, onRefreshShots, open, context?.sketchHistory, previewGenerating]);

  const handleGenerate = async () => {
    setLocalBusy(true);
    setGenerateSubmitting(true);
    try {
      const result = await generateShotSketch(project.id, {
        shotId: shot.id,
        force: Boolean(shot.sketch),
        prompt: promptDraft.trim(),
        model,
        ratio,
      });
      setOptimisticSketchTaskId(result.taskId);
      void loadContextAndRuns({ quiet: true }).catch(() => {});
      void onRefreshCompositionTasks().catch(() => {});
      await onRefreshShots();
    } catch (error) {
      setOptimisticSketchTaskId(null);
      onError(error instanceof Error ? error.message : '生成分镜图失败');
    } finally {
      setGenerateSubmitting(false);
      setLocalBusy(false);
    }
  };

  const handleSelect = async (assetId: string) => {
    setLocalBusy(true);
    try {
      await setShotSketch(shot.id, { assetId });
      await onRefreshShots();
      await loadContextAndRuns();
    } catch (error) {
      onError(error instanceof Error ? error.message : '设置主分镜图失败');
    } finally {
      setLocalBusy(false);
    }
  };

  const handleSelectExisting = async (assetId: string) => {
    setLocalBusy(true);
    try {
      await setShotSketch(shot.id, {
        assetId,
        source: tab === 'scene' ? 'applied_scene_image' : 'applied_candidate',
      });
      await onRefreshShots();
      await loadContextAndRuns();
    } catch (error) {
      onError(error instanceof Error ? error.message : '设置主分镜图失败');
    } finally {
      setLocalBusy(false);
    }
  };

  const handleConfirmReferences = async (next: {
    compositionTaskIds: string[];
    characterStyleIds: string[];
    sceneIds: string[];
    itemIds: string[];
  }) => {
    setLocalBusy(true);
    try {
      await updateShot(shot.id, next);
      await onRefreshShots();
      await loadContextAndRuns();
    } catch (error) {
      onError(error instanceof Error ? error.message : '保存生成参考图失败');
      throw error;
    } finally {
      setLocalBusy(false);
    }
  };

  const handleRemoveReference = async (reference: ShotSketchReferenceAsset) => {
    if (!reference.removable || !reference.sourceId) return;
    const shotPatch = reference.scope === 'shot' ? buildShotReferenceRemovalPatch(shot, reference) : null;
    const taskPatch =
      reference.scope === 'compositionTask' && compositionTask
        ? buildCompositionTaskReferenceRemovalPatch(compositionTask, reference)
        : null;
    if (!shotPatch && !taskPatch) return;
    setLocalBusy(true);
    try {
      if (shotPatch) {
        await updateShot(shot.id, shotPatch);
        await onRefreshShots();
      }
      if (taskPatch && compositionTask) {
        await updateCompositionTask(compositionTask.id, taskPatch);
        await onRefreshCompositionTasks();
      }
      await loadContextAndRuns();
    } catch (error) {
      onError(error instanceof Error ? error.message : '移除生成参考图失败');
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
      <aside className="relative z-10 flex h-full w-full max-w-[760px] bg-white shadow-2xl">
        <SketchHistoryRail
          history={sketchHistory}
          currentSketchUrl={shot.sketch?.url ?? null}
          disabled={disabled}
          onPreview={(run) => {
            const image = run.image ?? run.sourceImage;
            if (image) setPreviewImage({ url: image.url, label: historyLabel(run) });
          }}
          onApply={(run) => {
            if (run.image) void handleSelect(run.image.id);
          }}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-start gap-3 border-b border-[var(--color-border)] px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-gray-500">分镜图设置 · Shot {shot.displayId}</div>
              <h2 className="mt-1 truncate text-lg font-semibold text-gray-900">
                {context?.scene.title || compositionTask?.title || '当前分镜'}
              </h2>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                检查分镜提示词和参考图后生成主分镜图，也可以从已有场景图或分镜候选中应用。
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white">
              <div className="bg-gray-50 px-4 py-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-gray-900">当前分镜图</span>
                  <StatusBadge shot={shot} isGenerating={previewGenerating} sketchFailed={sketchFailed} />
                </div>
                <div className="overflow-hidden rounded-lg bg-gray-100">
                  <div className="aspect-video">
                    <CurrentSketchPreview
                      imageUrl={shot.sketch?.url ?? null}
                      generating={previewGenerating}
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-[var(--color-border)] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">生成参考图</span>
                  <span className="text-xs text-gray-400">
                    {contextLoading ? '加载中...' : `${visibleReferenceAssets.length} 张`}
                  </span>
                </div>
                <ReferenceStrip
                  references={visibleReferenceAssets}
                  loading={contextLoading}
                  disabled={disabled}
                  imageRunByOwner={imageRunByOwner}
                  onAdd={() => setReferencePickerOpen(true)}
                  onOpenPicker={() => setReferencePickerOpen(true)}
                  onRemove={(reference) => void handleRemoveReference(reference)}
                />
              </div>

              <div className="border-t border-[var(--color-border)] p-4">
                <label className="text-xs font-medium text-gray-500">提示词</label>
                <textarea
                  rows={6}
                  value={promptDraft}
                  onChange={(event) => setPromptDraft(event.target.value)}
                  placeholder="描述主分镜图画面。默认已根据 Shot 和场景预填充，可直接编辑后生成。"
                  className="mt-1.5 w-full resize-none rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 font-mono text-sm leading-relaxed outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                />
                {!hasPrompt && <p className="mt-2 text-xs text-red-500">请先填写提示词。</p>}
              </div>

              <div className="flex flex-wrap items-end gap-3 border-t border-[var(--color-border)] px-4 py-3">
                <div className="min-w-[180px] flex-1">
                  <label className="text-xs font-medium text-gray-500">图像模型</label>
                  <select
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                  >
                    {IMAGE_MODEL_OPTIONS.map((option) => (
                      <option key={option.modelId} value={option.modelId}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[150px] flex-1">
                  <label className="text-xs font-medium text-gray-500">画面比例</label>
                  <select
                    value={ratio}
                    onChange={(event) => setRatio(event.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                  >
                    {RATIO_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end border-t border-[var(--color-border)] px-4 py-3">
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={disabled || !hasPrompt}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
                >
                  {localBusy || isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  {shot.sketch ? '重新生成' : '生成分镜图'}
                </button>
              </div>
            </section>

            <section className="mt-4 rounded-lg border border-[var(--color-border)] bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-gray-900">选择已有图</h3>
                <button
                  type="button"
                  onClick={() => void refreshRuns()}
                  disabled={runsLoading || !contextTaskId}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 text-xs font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:opacity-50"
                >
                  <RefreshCcw className={`h-3.5 w-3.5 ${runsLoading ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </div>

              <div className="mb-4 inline-flex rounded-lg bg-gray-100 p-1">
                <TabButton active={tab === 'scene'} onClick={() => setTab('scene')} icon={<ImageIcon className="h-4 w-4" />}>
                  场景图
                </TabButton>
                <TabButton active={tab === 'candidates'} onClick={() => setTab('candidates')} icon={<Grid3X3 className="h-4 w-4" />}>
                  分镜候选
                </TabButton>
              </div>

              {runsLoading ? (
                <div className="flex min-h-[220px] items-center justify-center text-sm text-gray-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  加载中…
                </div>
              ) : currentList.length === 0 ? (
                <EmptyState text={tab === 'scene' ? '当前场景还没有可用的场景图。' : '当前场景还没有可用的分镜候选。'} />
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {currentList.map((item) => (
                    <ExistingImageCard
                      key={item.id}
                      item={item}
                      disabled={disabled}
                      onPreview={() => setPreviewImage({ url: item.url, label: item.label })}
                      onApply={() => void handleSelectExisting(item.assetId)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </aside>
      <ReferencePickerDialog
        isOpen={referencePickerOpen}
        onClose={() => setReferencePickerOpen(false)}
        characters={characters}
        scenes={scenes}
        items={items}
        compositionTasks={compositionTasks}
        project={project}
        selected={referencePickerSelection}
        onRefreshReferences={onRefreshReferences}
        onConfirm={handleConfirmReferences}
        includeComposition={false}
        initialTab="selected"
      />
      <ImagePreview
        src={previewImage?.url ?? ''}
        alt={previewImage?.label}
        open={Boolean(previewImage)}
        onClose={() => setPreviewImage(null)}
      />
    </div>
  );
}

function StatusBadge({
  shot,
  isGenerating,
  sketchFailed,
}: {
  shot: Shot;
  isGenerating: boolean;
  sketchFailed: boolean;
}) {
  if (isGenerating) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-[var(--color-primary)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        生成中
      </span>
    );
  }
  if (shot.sketch) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        已设置
      </span>
    );
  }
  if (sketchFailed) {
    return <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600">生成失败</span>;
  }
  return <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">待选择</span>;
}

function CurrentSketchPreview({
  imageUrl,
  generating,
}: {
  imageUrl: string | null;
  generating: boolean;
}) {
  return (
    <div className="relative h-full w-full">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="当前分镜图" className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-500">
          待生成或从已有图中选择
        </div>
      )}
      {generating && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white/82 px-6 text-center backdrop-blur-sm">
          <div className="relative flex h-16 w-16 items-center justify-center">
            <span className="absolute h-16 w-16 rounded-full border-2 border-blue-100" />
            <span className="absolute h-16 w-16 animate-spin rounded-full border-2 border-transparent border-t-[var(--color-primary)]" />
            <ImagePlus className="h-7 w-7 text-[var(--color-primary)]" />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">正在生成新的主分镜图</div>
            <div className="mt-1 text-xs text-gray-500">完成后会自动更新当前图，并保存在左侧历史栏</div>
          </div>
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-blue-100">
            <div className="h-full w-1/2 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-[var(--color-primary)]" />
          </div>
        </div>
      )}
    </div>
  );
}

function SketchHistoryRail({
  history,
  currentSketchUrl,
  disabled,
  onPreview,
  onApply,
}: {
  history: ShotSketchHistoryRun[];
  currentSketchUrl: string | null;
  disabled: boolean;
  onPreview: (run: ShotSketchHistoryRun) => void;
  onApply: (run: ShotSketchHistoryRun) => void;
}) {
  return (
    <div className="flex w-[86px] shrink-0 flex-col border-r border-[var(--color-border)] bg-white px-3 py-4">
      <div className="mb-3 text-center text-[11px] font-medium text-gray-500">历史</div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {history.length === 0 ? (
          <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50">
            <ImageIcon className="h-5 w-5 text-gray-400" />
          </div>
        ) : (
          history.map((run) => {
            const image = run.image ?? run.sourceImage;
            const isRunning = isTaskPending(run.status);
            const isFailed = run.status === 'FAILED' || run.status === 'CANCELLED';
            const current = run.current || Boolean(image?.url && image.url === currentSketchUrl);
            return (
              <div key={run.id} className="group relative h-14 w-14">
                <button
                  type="button"
                  onClick={() => image && onPreview(run)}
                  disabled={!image}
                  className={`relative h-14 w-14 overflow-hidden rounded-lg border bg-gray-50 ${
                    current ? 'border-[var(--color-primary)] ring-2 ring-blue-100' : 'border-[var(--color-border)]'
                  }`}
                  aria-label={image ? '查看主分镜图历史' : historyLabel(run)}
                  title={image ? '点击放大' : historyLabel(run)}
                >
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image.url} alt="主分镜图历史" className="h-full w-full object-cover" />
                  ) : isRunning ? (
                    <span className="flex h-full w-full items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-[var(--color-primary)]" />
                    </span>
                  ) : isFailed ? (
                    <span className="flex h-full w-full items-center justify-center bg-red-50 text-[10px] font-medium text-red-600">
                      失败
                    </span>
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      <ImageIcon className="h-5 w-5 text-gray-400" />
                    </span>
                  )}
                  {current && (
                    <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-primary)] text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[9px] font-medium text-white">
                    {historyLabel(run)}
                  </span>
                </button>
                {!current && run.image && (
                  <button
                    type="button"
                    onClick={() => onApply(run)}
                    disabled={disabled}
                    className="absolute -bottom-1 -right-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-white opacity-100 shadow-sm transition-colors hover:bg-[var(--color-primary)] disabled:opacity-40 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100"
                    aria-label="设为当前主分镜图"
                    title="设为当前"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ReferenceStrip({
  references,
  loading,
  disabled,
  imageRunByOwner,
  onAdd,
  onOpenPicker,
  onRemove,
}: {
  references: ShotSketchReferenceAsset[];
  loading: boolean;
  disabled: boolean;
  imageRunByOwner: Map<string, ImageGenerationRun>;
  onAdd: () => void;
  onOpenPicker: () => void;
  onRemove: (reference: ShotSketchReferenceAsset) => void;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-5 gap-3">
        <div className="col-span-4 flex h-[112px] items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在匹配参考图…
        </div>
        <AddReferenceButton disabled={disabled} onClick={onAdd} />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-5 gap-3">
      {references.length === 0 && (
        <div className="col-span-4 flex h-[112px] items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 text-center text-sm text-gray-500">
          暂无可管理参考图。
        </div>
      )}
      {references.map((reference) => (
        <ReferenceCard
          key={reference.id}
          reference={reference}
          disabled={disabled}
          imageRunByOwner={imageRunByOwner}
          onOpenPicker={onOpenPicker}
          onRemove={onRemove}
        />
      ))}
      <AddReferenceButton disabled={disabled} onClick={onAdd} />
    </div>
  );
}

function ReferenceCard({
  reference,
  disabled,
  imageRunByOwner,
  onOpenPicker,
  onRemove,
}: {
  reference: ShotSketchReferenceAsset;
  disabled: boolean;
  imageRunByOwner: Map<string, ImageGenerationRun>;
  onOpenPicker: () => void;
  onRemove: (reference: ShotSketchReferenceAsset) => void;
}) {
  const { isGenerating, getError } = useGeneration();
  const hasImage = Boolean(reference.url);
  const ownerKey = referenceRunOwnerKey(reference);
  const activeRun = ownerKey ? imageRunByOwner.get(ownerKey) : null;
  const generationKind = reference.sourceId ? generationKindForReference(reference) : null;
  const realtimeGenerating = generationKind && reference.sourceId
    ? isGenerating(generationKind, reference.sourceId)
    : false;
  const persistedPending = isTaskPending(activeRun?.status ?? reference.resourceStatus);
  const generating = realtimeGenerating || persistedPending;
  const generationLabel = realtimeGenerating
    ? '生成中...'
    : taskPendingLabel(activeRun?.status ?? reference.resourceStatus) ?? '生成中...';
  const generationError = generationKind && reference.sourceId
    ? getError(generationKind, reference.sourceId) || activeRun?.error || reference.resourceError || null
    : activeRun?.error || reference.resourceError || null;
  return (
        <div
          className="group relative h-[112px] min-w-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-gray-50"
          title={`${SOURCE_LABEL[reference.source]} · ${reference.label}`}
        >
          <button
            type="button"
            onClick={onOpenPicker}
            disabled={disabled}
            className="absolute inset-0 cursor-pointer disabled:cursor-not-allowed"
            aria-label={`管理参考资产：${reference.label}`}
          >
            {hasImage ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={reference.url ?? ''} alt={reference.label} className="h-full w-full object-cover" />
                <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-black/55 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                  选择引用资产
                </span>
              </>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 text-center text-gray-500">
                <ImagePlus className="h-5 w-5 text-gray-400" />
                <span className="text-[11px] font-medium">待生成</span>
                <span className="line-clamp-1 text-[10px] text-gray-400">
                  选择引用资产
                </span>
              </div>
            )}
          </button>
          {generating && (
            <div className="pointer-events-none absolute inset-0 z-[2] flex flex-col items-center justify-center gap-1 bg-black/45 text-white">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs font-medium">{generationLabel}</span>
            </div>
          )}
          <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white">
            {SOURCE_LABEL[reference.source]}
          </span>
          {reference.removable ? (
            <button
              type="button"
              onClick={() => onRemove(reference)}
              disabled={disabled}
              className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-100 transition-colors hover:bg-red-500 disabled:opacity-40 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100"
              aria-label={`移除参考图：${reference.label}`}
              title="移除参考图"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <span className="absolute right-1.5 top-1.5 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 shadow-sm">
              自动
            </span>
          )}
          <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-2 py-1.5 text-xs font-medium text-white">
            {generationError && !generating ? `生成失败 · ${reference.label}` : reference.label}
          </span>
        </div>
  );
}

function AddReferenceButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-[112px] min-w-0 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-2 text-gray-600 transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
      aria-label="添加生成参考图"
      title="添加生成参考图"
    >
      <Plus className="h-6 w-6" />
      <span className="text-xs font-medium">添加参考图</span>
    </button>
  );
}

function historyLabel(run: ShotSketchHistoryRun): string {
  if (isTaskPending(run.status)) return '生成中';
  if (run.status === 'FAILED') return '失败';
  if (run.status === 'CANCELLED') return '取消';
  if (run.source === 'applied_scene_image') return '场景图';
  if (run.source === 'applied_candidate') return '候选图';
  if (run.source === 'manual') return '已应用';
  return '生成';
}

function ExistingImageCard({
  item,
  disabled,
  onPreview,
  onApply,
}: {
  item: ExistingImage;
  disabled: boolean;
  onPreview: () => void;
  onApply: () => void;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border bg-white transition-colors ${
        item.selected ? 'border-[var(--color-primary)] ring-2 ring-blue-100' : 'border-[var(--color-border)]'
      }`}
    >
      <button
        type="button"
        onClick={onPreview}
        className="group relative block aspect-video w-full cursor-zoom-in bg-gray-100"
        aria-label={`查看已有图：${item.label}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.url} alt={item.label} className="h-full w-full object-cover" />
        <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-black/55 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
          点击放大
        </span>
        {item.selected && (
          <span className="absolute left-2 top-2 rounded bg-[var(--color-primary)] px-2 py-0.5 text-xs font-medium text-white">
            当前使用
          </span>
        )}
      </button>
      <div className="p-2">
        <div className="truncate text-sm font-medium text-gray-900">{item.label}</div>
        <div className="truncate text-xs text-gray-500">{item.sublabel}</div>
        <button
          type="button"
          onClick={onApply}
          disabled={disabled || item.selected}
          className="mt-2 inline-flex h-7 w-full items-center justify-center rounded-md bg-gray-900 px-2 text-xs font-semibold text-white hover:bg-gray-700 disabled:bg-gray-200 disabled:text-gray-500"
        >
          {item.selected ? '已应用' : '应用'}
        </button>
      </div>
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
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium ${
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
    <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 text-center text-sm text-gray-500">
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
