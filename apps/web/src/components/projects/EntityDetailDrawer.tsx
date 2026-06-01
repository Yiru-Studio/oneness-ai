'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useRef, useState } from 'react';
import {
  X,
  Check,
  Sparkles,
  Loader2,
  ImagePlus,
  Wand2,
  Upload,
} from 'lucide-react';
import { Project, ResourceImage, ResourceImageKind } from '@/types';
import { ImagePreview } from '@/components/ImagePreview';
import {
  uploadAsset,
  createImageTask,
  createResourceImage,
  getResourceImages,
  pollTaskUntilDone,
  updateResourceImage,
  type TaskDTO,
} from '@/lib/api';
import {
  IMAGE_MODEL_OPTIONS,
  imageProviderForModel,
} from '@/data/style-presets';
import { useGeneration } from '@/contexts/GenerationContext';

/**
 * Generic secondary-detail drawer used by Items, Scenes, and CharacterStyles.
 *
 * For `kind === 'style'`, the prompt area exposes a 三视图 chip that prepends
 * an `@三视图` marker to the prompt; the worker expands the marker into a
 * canonical three-view layout prompt before calling the image model.
 */

export const THREE_VIEW_MARKER = '@三视图';

export type EntityKind = 'item' | 'scene' | 'style' | 'character-avatar';

export type EntityDetailData = {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  model?: string | null;
  ratio?: string | null;
  image?: string;
  assetId?: string | null;
};

interface Props {
  open: boolean;
  kind: EntityKind;
  /** Entity being edited. Always provides an `id`; image may be empty. */
  entity: EntityDetailData;
  project: Project;
  /** When provided, the character's identity master is sent as the first
   *  reference image during generation to maintain visual consistency. */
  characterId?: string;
  identityReferenceAssetId?: string | null;
  /** Build the default auto-fill prompt for this entity. Called when the user
   *  hits "自动填充". Implementations typically pull lines from the script and
   *  combine with project style guidance. */
  buildAutoPrompt: () => string;
  /** Persist a partial update of the entity. Server returns the fresh row. */
  onSave: (patch: {
    name?: string;
    description?: string;
    prompt?: string;
    model?: string | null;
    ratio?: string | null;
    assetId?: string | null;
  }) => Promise<EntityDetailData>;
  /** Optional secondary action — delete the entity. */
  onDelete?: () => Promise<void>;
  /** Let the underlying page keep receiving clicks while the side drawer is open. */
  allowBackgroundInteraction?: boolean;
  onClose: () => void;
}

function parseThreeViewPrompt(raw: string): { threeView: boolean; body: string } {
  const re = new RegExp(`^${THREE_VIEW_MARKER}\\s*\\n?`);
  if (re.test(raw)) return { threeView: true, body: raw.replace(re, '') };
  return { threeView: false, body: raw };
}

function composeThreeViewPrompt(threeView: boolean, body: string): string {
  if (!threeView) return body;
  return body ? `${THREE_VIEW_MARKER}\n${body}` : THREE_VIEW_MARKER;
}

const RATIO_OPTIONS = [
  { value: '1:1', label: '1:1 方形' },
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];

const KIND_LABEL: Record<EntityKind, string> = {
  item: '物品',
  scene: '场景',
  style: '造型',
  'character-avatar': '角色头像',
};

type ImageGenerationPhase = 'idle' | 'queueing' | 'queued' | 'running' | 'saving' | 'failed';

const IMAGE_GENERATION_LABEL: Record<ImageGenerationPhase, string> = {
  idle: '',
  queueing: '提交任务中…',
  queued: '排队中…',
  running: '生成中…',
  saving: '保存结果中…',
  failed: '生成失败',
};

function phaseForTaskStatus(status: TaskDTO['status']): ImageGenerationPhase {
  if (status === 'QUEUED') return 'queued';
  if (status === 'RUNNING') return 'running';
  if (status === 'FAILED' || status === 'CANCELLED') return 'failed';
  return 'saving';
}

function resourceKindForEntity(kind: EntityKind): ResourceImageKind | null {
  if (kind === 'style') return 'character-style';
  if (kind === 'scene') return 'scene';
  if (kind === 'item') return 'item';
  return null;
}

function historyKey(kind: ResourceImageKind, entityId: string): string {
  return `${kind}:${entityId}`;
}

type GenerationMode = 'single' | 'three-view';

type ViewingImageState = {
  historyId: string | null;
  assetId: string | null;
  image: string;
  status: ResourceImage['status'] | null;
  error: string | null;
  source: ResourceImage['source'] | null;
};

function generationModeFromPrompt(raw: string): { mode: GenerationMode; body: string } {
  const parsed = parseThreeViewPrompt(raw);
  return {
    mode: parsed.threeView ? 'three-view' : 'single',
    body: parsed.body,
  };
}

function composePromptForMode(mode: GenerationMode, body: string): string {
  return composeThreeViewPrompt(mode === 'three-view', body);
}

function statusForResourceImage(row: ResourceImage): ResourceImage['status'] {
  return row.taskStatus ?? row.status;
}

function viewingFromEntity(entity: EntityDetailData): ViewingImageState {
  return {
    historyId: null,
    assetId: entity.assetId ?? null,
    image: entity.image || '',
    status: null,
    error: null,
    source: null,
  };
}

function viewingFromResource(row: ResourceImage): ViewingImageState {
  return {
    historyId: row.id,
    assetId: row.assetId,
    image: row.image || '',
    status: statusForResourceImage(row),
    error: row.error,
    source: row.source,
  };
}

export function EntityDetailDrawer({
  open,
  kind,
  entity,
  project,
  characterId,
  identityReferenceAssetId,
  buildAutoPrompt,
  onSave,
  allowBackgroundInteraction = false,
  onClose,
}: Props) {
  const [name, setName] = useState(entity.name);
  const [description, setDescription] = useState(entity.description ?? '');
  const initialParsed = generationModeFromPrompt(entity.prompt ?? '');
  const [promptBody, setPromptBody] = useState(initialParsed.body);
  const [generationMode, setGenerationMode] = useState<GenerationMode>(initialParsed.mode);
  const [model, setModel] = useState(entity.model || project.imageModel);
  const [ratio, setRatio] = useState(
    entity.ratio || project.ratio,
  );
  const [image, setImage] = useState(entity.image || '');
  const [assetId, setAssetId] = useState(entity.assetId ?? null);
  const [viewing, setViewing] = useState<ViewingImageState>(() => viewingFromEntity(entity));
  const { isGenerating, getError, clearError, runGeneration } = useGeneration();
  const generating = isGenerating(kind, entity.id);
  const remoteError = getError(kind, entity.id);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [history, setHistory] = useState<ResourceImage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyBusy, setHistoryBusy] = useState<string | null>(null);
  const [generationPhase, setGenerationPhase] = useState<ImageGenerationPhase>('idle');
  const fileRef = useRef<HTMLInputElement>(null);
  const activeHistoryKeyRef = useRef<string | null>(null);
  const activeEntityIdRef = useRef(entity.id);
  const currentAssetIdRef = useRef(entity.assetId ?? null);

  // Reference image uploaded by user for AI to use during generation.
  const [referenceAssetId, setReferenceAssetId] = useState<string | null>(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string>('');
  const refFileRef = useRef<HTMLInputElement>(null);

  const setCurrentImageState = (nextAssetId: string | null, nextImage: string) => {
    currentAssetIdRef.current = nextAssetId;
    setAssetId(nextAssetId);
    setImage(nextImage);
  };

  // Reset state when the entity changes.
  useEffect(() => {
    activeEntityIdRef.current = entity.id;
    currentAssetIdRef.current = entity.assetId ?? null;
    setName(entity.name);
    setDescription(entity.description ?? '');
    const parsed = generationModeFromPrompt(entity.prompt ?? '');
    setPromptBody(parsed.body);
    setGenerationMode(parsed.mode);
    setModel(entity.model || project.imageModel);
    setRatio(
      entity.ratio || project.ratio,
    );
    setImage(entity.image || '');
    setAssetId(entity.assetId ?? null);
    setViewing({
      historyId: null,
      assetId: entity.assetId ?? null,
      image: entity.image || '',
      status: null,
      error: null,
      source: null,
    });
    setError(null);
    setGenerationPhase('idle');
    setPreviewOpen(false);
  }, [entity.id, entity.name, entity.description, entity.prompt, entity.model, entity.ratio, entity.image, entity.assetId, project.imageModel, project.ratio, kind]);

  const resourceKind = resourceKindForEntity(kind);

  useEffect(() => {
    if (!resourceKind) {
      activeHistoryKeyRef.current = null;
      setHistory([]);
      setHistoryLoading(false);
      return;
    }
    activeHistoryKeyRef.current = historyKey(resourceKind, entity.id);
    setHistory([]);
    setHistoryLoading(true);
    void refreshHistory(resourceKind, entity.id);
  }, [resourceKind, entity.id]);

  useEffect(() => {
    if (!viewing.historyId) return;
    const row = history.find((item) => item.id === viewing.historyId);
    if (!row) return;
    const next = viewingFromResource(row);
    setViewing((prev) => {
      if (
        prev.historyId === next.historyId &&
        prev.assetId === next.assetId &&
        prev.image === next.image &&
        prev.status === next.status &&
        prev.error === next.error
      ) {
        return prev;
      }
      return next;
    });
  }, [history, viewing.historyId]);

  async function refreshHistory(kind: ResourceImageKind, entityId: string) {
    const key = historyKey(kind, entityId);
    if (activeHistoryKeyRef.current !== key) return;
    setHistoryLoading(true);
    try {
      const rows = await getResourceImages(kind, entityId);
      if (activeHistoryKeyRef.current === key) setHistory(rows);
    } catch (e) {
      if (activeHistoryKeyRef.current === key) {
        setError(e instanceof Error ? e.message : '图片历史加载失败');
      }
    } finally {
      if (activeHistoryKeyRef.current === key) setHistoryLoading(false);
    }
  }

  if (!open) return null;

  const composedPrompt = composePromptForMode(generationMode, promptBody);
  // The 三视图 chip alone is a valid prompt (the worker expands it); otherwise
  // there must be prompt text. Empty → Generate is disabled to block invalid requests.
  const hasPrompt = generationMode === 'three-view' || promptBody.trim().length > 0;
  const dirty =
    name !== entity.name ||
    description !== (entity.description ?? '') ||
    composedPrompt !== (entity.prompt ?? '') ||
    model !== (entity.model || project.imageModel) ||
    ratio !== (entity.ratio || project.ratio);
  const infoDirty =
    name !== entity.name ||
    description !== (entity.description ?? '');

  const isStyle = kind === 'style';
  const hasStyleIdentityReference = !isStyle || Boolean(identityReferenceAssetId);
  const generateDisabled = generating || uploading || !hasPrompt || !hasStyleIdentityReference;
  const generateTitle = !hasPrompt
    ? isStyle
      ? '请先填写造型描述或选择「三视图」'
      : '请先填写提示词'
    : !hasStyleIdentityReference
      ? '请先生成或上传角色头像'
      : undefined;
  const handleAutoFill = () => {
    const auto = buildAutoPrompt();
    const parsed = generationModeFromPrompt(auto);
    setGenerationMode(parsed.mode);
    setPromptBody(parsed.body);
  };

  const handleSaveInfo = async () => {
    setError(null);
    try {
      const fresh = await onSave({
        name: name.trim() || entity.name,
        description,
      });
      setName(fresh.name);
      setDescription(fresh.description ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存信息失败');
    }
  };

  const handleGenerate = async () => {
    const generationEntityId = entity.id;
    const generationResourceKind = resourceKind;
    const isActiveGeneration = () => activeEntityIdRef.current === generationEntityId;
    let effectivePromptBody = promptBody.trim();
    let effectiveGenerationMode = generationMode;
    if (!effectivePromptBody && effectiveGenerationMode !== 'three-view') {
      const parsed = generationModeFromPrompt(buildAutoPrompt());
      effectivePromptBody = parsed.body;
      effectiveGenerationMode = parsed.mode;
    }
    const effectivePrompt = composePromptForMode(effectiveGenerationMode, effectivePromptBody);
    if (!effectivePrompt) {
      setError('请先填写提示词');
      return;
    }
    if (!hasStyleIdentityReference) {
      setError('请先生成或上传角色头像，作为造型生成的身份母版');
      return;
    }
    setError(null);
    setGenerationPhase('queueing');
    clearError(kind, entity.id);
    try {
      await runGeneration(kind, entity.id, async () => {
        // First, persist any dirty fields including the prompt.
        if (dirty || effectivePrompt !== (entity.prompt ?? '')) {
          await onSave({
            name: name.trim() || entity.name,
            description,
            prompt: effectivePrompt,
            model,
            ratio,
          });
        }
        const task = await createImageTask(
          project.id,
          {
            prompt: effectivePrompt,
            ratio,
            model: model || project.imageModel,
            n: 1,
            ...(referenceAssetId ? { referenceAssetIds: [referenceAssetId] } : {}),
            ...(characterId ? { characterId } : {}),
          },
          imageProviderForModel(model || project.imageModel),
          generationResourceKind ? { kind: generationResourceKind, entityId: generationEntityId } : undefined,
        );
        if (isActiveGeneration()) setGenerationPhase(phaseForTaskStatus(task.status));
        if (generationResourceKind) await refreshHistory(generationResourceKind, generationEntityId);
        const final = await pollTaskUntilDone(task.id, {
          intervalMs: 2000,
          onTick: (tick) => {
            if (isActiveGeneration()) setGenerationPhase(phaseForTaskStatus(tick.status));
            if (generationResourceKind) void refreshHistory(generationResourceKind, generationEntityId);
          },
        });
        if (generationResourceKind) await refreshHistory(generationResourceKind, generationEntityId);
        if (final.status !== 'SUCCEEDED' || !final.outputAssets?.[0]) {
          throw new Error(final.error || '生成失败');
        }
        if (isActiveGeneration()) setGenerationPhase('saving');
        const outputAssetId = final.outputAssets[0].id;
        if (isStyle) {
          // The generated image is kept as a history candidate. Restore the
          // current image so viewing/using a version stays an explicit choice.
          const fresh = await onSave({ assetId: currentAssetIdRef.current });
          if (isActiveGeneration()) {
            setCurrentImageState(fresh.assetId ?? currentAssetIdRef.current, fresh.image || '');
            setGenerationPhase('idle');
          }
        } else {
          const fresh = await onSave({ assetId: outputAssetId });
          if (isActiveGeneration()) {
            setCurrentImageState(fresh.assetId ?? outputAssetId, fresh.image || '');
            setViewing(viewingFromEntity(fresh));
            setGenerationPhase('idle');
          }
        }
      });
    } catch (e) {
      if (isActiveGeneration()) {
        setGenerationPhase('failed');
        setError(e instanceof Error ? e.message : '生成失败');
      }
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const asset = await uploadAsset(file);
      let uploadedRow: ResourceImage | null = null;
      if (resourceKind) {
        uploadedRow = await createResourceImage({
          kind: resourceKind,
          entityId: entity.id,
          source: 'upload',
          status: 'SUCCEEDED',
          prompt: composedPrompt,
          model,
          ratio,
          assetId: asset.id,
          setAsCurrent: true,
        });
      }
      const fresh = await onSave({ assetId: asset.id });
      const nextAssetId = fresh.assetId ?? asset.id;
      const nextImage = fresh.image || uploadedRow?.image || asset.url || '';
      setCurrentImageState(nextAssetId, nextImage);
      setViewing(
        uploadedRow
          ? viewingFromResource({ ...uploadedRow, assetId: nextAssetId, image: nextImage })
          : viewingFromEntity({ ...fresh, assetId: nextAssetId, image: nextImage }),
      );
      if (resourceKind) await refreshHistory(resourceKind, entity.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleUploadReference = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const asset = await uploadAsset(file);
      setReferenceAssetId(asset.id);
      setReferenceImageUrl(asset.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传参考图失败');
    } finally {
      setUploading(false);
    }
  };

  const handleSetCurrent = async (row: ResourceImage) => {
    if (!row.assetId || !resourceKind) return;
    setHistoryBusy(row.id);
    setError(null);
    try {
      await updateResourceImage(row.id, { setAsCurrent: true });
      const fresh = await onSave({ assetId: row.assetId });
      const nextAssetId = fresh.assetId ?? row.assetId;
      const nextImage = fresh.image || row.image || '';
      setCurrentImageState(nextAssetId, nextImage);
      setViewing(viewingFromResource({ ...row, assetId: nextAssetId, image: nextImage }));
      await refreshHistory(resourceKind, entity.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '设置当前图片失败');
    } finally {
      setHistoryBusy(null);
    }
  };

  const handleSelectHistory = (row: ResourceImage) => {
    setViewing(viewingFromResource(row));
  };

  const aspectClass =
    ratio === '16:9'
      ? 'aspect-video'
      : ratio === '9:16'
        ? 'aspect-[9/16]'
        : ratio === '4:3'
          ? 'aspect-[4/3]'
          : ratio === '3:4'
          ? 'aspect-[3/4]'
            : 'aspect-square';
  const previewWidthClass =
    ratio === '9:16' || ratio === '3:4'
      ? 'w-[min(100%,340px)]'
      : ratio === '1:1'
        ? 'w-[min(100%,520px)]'
        : 'w-full';
  const generationLabel = IMAGE_GENERATION_LABEL[
    generating && generationPhase === 'idle' ? 'queueing' : generationPhase
  ];
  const viewingPending = viewing.status === 'QUEUED' || viewing.status === 'RUNNING';
  const viewingFailed = viewing.status === 'FAILED' || viewing.status === 'CANCELLED';
  const viewingLabel =
    viewing.status === 'QUEUED'
      ? '排队中…'
      : viewing.status === 'RUNNING'
        ? '生成中…'
        : viewing.status === 'CANCELLED'
          ? '已取消'
          : '生成失败';
  const visibleError = viewingFailed
    ? viewing.error || viewingLabel
    : error || (!viewing.image ? remoteError : null);
  const previewImage = viewing.image;
  const hasPreviewImage = Boolean(previewImage);
  const showPreviewBusyOverlay = (viewingPending || generating || uploading) && !hasPreviewImage;
  const showPreviewBusyBadge = (viewingPending || generating || uploading) && hasPreviewImage;
  const showPreviewErrorOverlay = Boolean(visibleError) && !viewingFailed && !viewingPending && !generating && !uploading && !hasPreviewImage;
  const showPreviewErrorBadge = viewingFailed && Boolean(visibleError) && hasPreviewImage;
  const previewBusyLabel = viewingPending ? viewingLabel : generating ? generationLabel || '生成中…' : '上传中…';

  return (
    <>
    <div
      className={`fixed inset-0 z-[1900] flex justify-end bg-black/30 ${
        allowBackgroundInteraction ? 'pointer-events-none' : ''
      }`}
      onClick={allowBackgroundInteraction ? undefined : onClose}
    >
      <div
        className="pointer-events-auto w-[840px] max-w-[100vw] h-full bg-white shadow-2xl flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {resourceKind && (
          <HistoryRail
            history={history}
            loading={historyLoading}
            currentAssetId={assetId}
            viewingHistoryId={viewing.historyId}
            viewingAssetId={viewing.assetId}
            identityReferenceAssetId={identityReferenceAssetId ?? null}
            busyId={historyBusy}
            onSelect={handleSelectHistory}
            onSetCurrent={handleSetCurrent}
          />
        )}
        <div className="min-w-0 flex-1 h-full overflow-y-auto">
          <div className="sticky top-0 z-10 bg-white border-b border-[var(--color-border)] px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-[var(--color-text-secondary)]">
                  {KIND_LABEL[kind]}详情
                </div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-0.5 w-full px-2 py-1 -ml-2 rounded-lg border border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none text-lg font-semibold bg-transparent"
                  placeholder={`${KIND_LABEL[kind]}名称`}
                />
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full px-2 py-1 -ml-2 rounded-lg border border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none text-sm leading-relaxed text-[var(--color-text-secondary)] bg-transparent resize-none"
                  placeholder={`${KIND_LABEL[kind]}描述`}
                />
                {visibleError && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <X className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium">生成失败</div>
                      <div className="mt-0.5 break-words">{visibleError}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {infoDirty && (
                  <button
                    onClick={handleSaveInfo}
                    className="px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm hover:bg-gray-50"
                  >
                    保存信息
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                  aria-label="关闭"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div className="rounded-xl border border-[var(--color-border)] bg-gray-50 p-4">
              <div
                className={`relative mx-auto ${previewWidthClass} ${aspectClass} rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center`}
              >
                {previewImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewImage}
                    alt={name}
                    className="w-full h-full object-contain cursor-pointer"
                    onClick={() => setPreviewOpen(true)}
                  />
                ) : viewingFailed ? (
                  <div className="flex h-full w-full flex-col items-center justify-center px-6 text-center text-red-700">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                      <X className="h-5 w-5" />
                    </div>
                    <div className="mt-3 text-sm font-semibold">生成失败</div>
                    <div className="mt-1 max-w-[520px] text-xs leading-5 text-red-600">
                      {visibleError || '生成失败'}
                    </div>
                    <button
                      onClick={handleGenerate}
                      disabled={generateDisabled}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
                    >
                      <Sparkles className="h-4 w-4" />
                      重试生成
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-gray-400 w-full h-full text-center px-4">
                    <ImagePlus className="w-10 h-10" />
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="mt-4 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-white text-sm text-[var(--color-text)] hover:bg-gray-50"
                    >
                      上传成品图
                    </button>
                  </div>
                )}
                {showPreviewBusyOverlay && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white">
                    <Loader2 className="w-7 h-7 animate-spin" />
                    <span className="ml-2 text-sm">
                      {previewBusyLabel}
                    </span>
                  </div>
                )}
                {showPreviewBusyBadge && (
                  <div className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {previewBusyLabel}
                  </div>
                )}
                {showPreviewErrorOverlay && (
                  <div
                    className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-red-50/95 px-6 text-center text-red-700"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                      <X className="h-5 w-5" />
                    </div>
                    <div className="mt-3 text-sm font-semibold">生成失败</div>
                    <div className="mt-1 max-w-[520px] text-xs leading-5 text-red-600">
                      {visibleError}
                    </div>
                  </div>
                )}
                {showPreviewErrorBadge && (
                  <div
                    className="pointer-events-none absolute right-3 top-3 inline-flex max-w-[min(520px,calc(100%-24px))] items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white"
                    title={visibleError ?? undefined}
                  >
                    <X className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">生成失败</span>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-border)] bg-white">
              <div className="border-b border-[var(--color-border)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-[280px] flex-1">
                    <div className="text-xs font-medium text-[var(--color-text-secondary)]">
                      生成参考
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {isStyle && (
                        <div
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${
                            hasStyleIdentityReference
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                          title={
                            hasStyleIdentityReference
                              ? '造型生成会优先使用角色身份母版'
                              : '缺少角色头像时不能生成造型'
                          }
                        >
                          {hasStyleIdentityReference ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}
                          身份母版：{hasStyleIdentityReference ? '已绑定' : '缺少'}
                        </div>
                      )}
                      {referenceImageUrl ? (
                        <div className="inline-flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={referenceImageUrl}
                            alt="用户参考图"
                            className="h-8 w-8 rounded-md border border-[var(--color-border)] object-cover"
                          />
                          <span className="text-xs text-[var(--color-text-secondary)]">
                            用户参考图：已添加
                          </span>
                          <button
                            onClick={() => {
                              setReferenceAssetId(null);
                              setReferenceImageUrl('');
                            }}
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            title="移除参考图"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => refFileRef.current?.click()}
                          disabled={generating || uploading}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
                          title="上传本地图片作为 AI 生成参考"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          添加参考图
                        </button>
                      )}
                    </div>
                    {isStyle && (
                      <div className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">
                        生成时会使用：身份母版 + 用户参考图 + 造型描述。
                      </div>
                    )}
                  </div>

                  {isStyle && (
                    <div className="w-[220px] shrink-0">
                      <div className="text-xs font-medium text-[var(--color-text-secondary)]">
                        生成模式
                      </div>
                      <div className="mt-2 grid grid-cols-2 rounded-lg bg-gray-100 p-1">
                        <button
                          type="button"
                          onClick={() => setGenerationMode('single')}
                          className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                            generationMode === 'single'
                              ? 'bg-white text-[var(--color-text)] shadow-sm'
                              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                          }`}
                        >
                          单张造型
                        </button>
                        <button
                          type="button"
                          onClick={() => setGenerationMode('three-view')}
                          className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                            generationMode === 'three-view'
                              ? 'bg-white text-[var(--color-text)] shadow-sm'
                              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                          }`}
                        >
                          三视图
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={refFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUploadReference(f);
                    e.target.value = '';
                  }}
                />
              </div>

              <div className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                    {isStyle ? '造型描述' : '提示词'}
                  </label>
                  {!isStyle && (
                    <button
                      onClick={handleAutoFill}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-gray-50"
                      title="基于剧本 / 项目自动生成提示词"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      自动填充
                    </button>
                  )}
                </div>
                <div className="mt-1.5 rounded-lg border border-[var(--color-border)] focus-within:border-[var(--color-primary)] focus-within:ring-1 focus-within:ring-[var(--color-primary)] overflow-hidden">
                  <textarea
                    rows={5}
                    value={promptBody}
                    onChange={(e) => setPromptBody(e.target.value)}
                    placeholder={
                      isStyle
                        ? '描述这个造型的服装、姿态、表情和画面要求。'
                        : '描述你希望生成的画面。也可以点击「自动填充」由剧本上下文和项目风格自动生成。'
                    }
                    className="w-full px-3 py-2 outline-none text-sm resize-none leading-relaxed bg-transparent"
                  />
                </div>
                {!isStyle && (
                  <details className="mt-3 rounded-lg border border-[var(--color-border)] bg-gray-50 px-3 py-2">
                    <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-secondary)]">
                      高级提示词
                    </summary>
                    <div className="mt-2 whitespace-pre-wrap rounded-md bg-white p-3 text-xs leading-5 text-[var(--color-text-secondary)]">
                      {composedPrompt || '暂无提示词'}
                    </div>
                  </details>
                )}
              </div>

              <div className="px-4 py-3 border-t border-[var(--color-border)] flex flex-wrap items-end gap-3">
                <div className="min-w-[180px] flex-1">
                  <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                    图像模型
                  </label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="mt-1.5 w-full px-3 py-2 rounded-lg border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none text-sm bg-white"
                  >
                    {IMAGE_MODEL_OPTIONS.map((o) => (
                      <option key={o.modelId} value={o.modelId}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[140px] flex-1">
                  <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                    画面比例
                  </label>
                  <select
                    value={ratio}
                    onChange={(e) => setRatio(e.target.value)}
                    className="mt-1.5 w-full px-3 py-2 rounded-lg border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none text-sm bg-white"
                  >
                    {RATIO_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={generateDisabled}
                  title={generateTitle}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {generating
                    ? generationLabel || '生成中…'
                    : isStyle
                      ? assetId
                        ? '生成新版本'
                        : '生成造型图'
                      : image
                        ? '重新生成'
                        : '生成图片'}
                </button>
              </div>
              {generating && generationLabel && (
                <div className="px-4 pb-3 text-xs text-blue-600 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {generationLabel}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>

    <ImagePreview
      src={previewImage}
      alt={name}
      open={previewOpen}
      onClose={() => setPreviewOpen(false)}
    />
    </>
  );
}

function HistoryRail({
  history,
  loading,
  currentAssetId,
  viewingHistoryId,
  viewingAssetId,
  identityReferenceAssetId,
  busyId,
  onSelect,
  onSetCurrent,
}: {
  history: ResourceImage[];
  loading: boolean;
  currentAssetId: string | null;
  viewingHistoryId: string | null;
  viewingAssetId: string | null;
  identityReferenceAssetId: string | null;
  busyId: string | null;
  onSelect: (row: ResourceImage) => void;
  onSetCurrent: (row: ResourceImage) => void;
}) {
  return (
    <aside className="w-20 shrink-0 border-r border-[var(--color-border)] bg-white px-2 py-4 flex flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto scrollbar-none">
        {loading && history.length === 0 ? (
          <div className="w-full aspect-square rounded-lg bg-gray-100 flex items-center justify-center">
            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
          </div>
        ) : history.length === 0 ? (
          <div className="w-full aspect-square rounded-lg border border-dashed border-[var(--color-border)] flex items-center justify-center">
            <ImagePlus className="w-4 h-4 text-gray-300" />
          </div>
        ) : (
          history.map((row) => {
            const status = statusForResourceImage(row);
            const pending = status === 'QUEUED' || status === 'RUNNING';
            const failed = status === 'FAILED' || status === 'CANCELLED';
            const current = Boolean(row.assetId && row.assetId === currentAssetId);
            const viewing =
              row.id === viewingHistoryId ||
              Boolean(!viewingHistoryId && row.assetId && row.assetId === viewingAssetId);
            const canSetCurrent = Boolean(row.assetId && !pending && !failed && !current);
            const usedIdentityReference = Boolean(
              row.identityReferenceAssetId &&
                row.identityReferenceAssetId === identityReferenceAssetId,
            );
            return (
              <div key={row.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(row)}
                  disabled={busyId === row.id}
                  className={`relative w-full aspect-square overflow-hidden rounded-lg border transition-colors ${
                    viewing
                      ? 'border-[var(--color-primary)] ring-2 ring-blue-100'
                      : failed
                        ? 'border-red-200 hover:border-red-300'
                        : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'
                  } disabled:cursor-default`}
                  title={
                    failed
                      ? row.error || '生成失败'
                      : pending
                        ? '生成中'
                        : current
                          ? '当前使用版本'
                          : usedIdentityReference
                            ? '使用身份母版生成'
                            : row.source === 'upload'
                              ? '上传图片'
                              : '生成历史'
                  }
                >
                  {row.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={row.image}
                      alt=""
                      className={`h-full w-full object-cover ${pending ? 'opacity-65' : ''}`}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gray-100">
                      {pending || busyId === row.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                      ) : failed ? (
                        <X className="h-4 w-4 text-red-500" />
                      ) : (
                        <ImagePlus className="h-4 w-4 text-gray-400" />
                      )}
                    </div>
                  )}
                  {current && (
                    <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-primary)] text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                  {pending && (
                    <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white">
                      <Loader2 className="h-3 w-3 animate-spin" />
                    </span>
                  )}
                  {failed && (
                    <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white">
                      <X className="h-3 w-3" />
                    </span>
                  )}
                  {usedIdentityReference && (
                    <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1 text-[9px] font-semibold leading-4 text-white">
                      ID
                    </span>
                  )}
                </button>
                {canSetCurrent && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetCurrent(row);
                    }}
                    className={`absolute inset-x-1 bottom-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-medium leading-4 text-white transition-opacity hover:bg-black/80 ${
                      viewing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {busyId === row.id ? '设置中' : '设为当前'}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
