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

const INTERACTIVE_BACKGROUND_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[contenteditable="true"]',
].join(',');

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
  if (kind === 'character-avatar') return 'character-avatar';
  if (kind === 'style') return 'character-style';
  if (kind === 'scene') return 'scene';
  if (kind === 'item') return 'item';
  return null;
}

function isResourceImagePending(row: ResourceImage | null | undefined): boolean {
  return row?.status === 'QUEUED' || row?.status === 'RUNNING';
}

function historyKey(kind: ResourceImageKind, entityId: string): string {
  return `${kind}:${entityId}`;
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
  const initialParsed = parseThreeViewPrompt(entity.prompt ?? '');
  const [promptBody, setPromptBody] = useState(initialParsed.body);
  const [threeView, setThreeView] = useState(initialParsed.threeView);
  const [model, setModel] = useState(entity.model || project.imageModel);
  const [ratio, setRatio] = useState(
    entity.ratio || project.ratio,
  );
  const [image, setImage] = useState(entity.image || '');
  const [assetId, setAssetId] = useState(entity.assetId ?? null);
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
  const drawerRef = useRef<HTMLDivElement>(null);
  const activeHistoryKeyRef = useRef<string | null>(null);
  const activeEntityIdRef = useRef(entity.id);

  // Reference image uploaded by user for AI to use during generation.
  const [referenceAssetId, setReferenceAssetId] = useState<string | null>(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState<string>('');
  const refFileRef = useRef<HTMLInputElement>(null);

  // Reset state when the entity changes.
  useEffect(() => {
    activeEntityIdRef.current = entity.id;
    setName(entity.name);
    setDescription(entity.description ?? '');
    const parsed = parseThreeViewPrompt(entity.prompt ?? '');
    setPromptBody(parsed.body);
    setThreeView(parsed.threeView);
    setModel(entity.model || project.imageModel);
    setRatio(
      entity.ratio || project.ratio,
    );
    setImage(entity.image || '');
    setAssetId(entity.assetId ?? null);
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
    if (!open || !resourceKind || !history.some(isResourceImagePending)) return;
    const timer = window.setInterval(() => {
      void refreshHistory(resourceKind, entity.id);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [open, resourceKind, entity.id, history]);

  useEffect(() => {
    if (!open || !allowBackgroundInteraction || previewOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (drawerRef.current?.contains(target)) return;
      if (target.closest(INTERACTIVE_BACKGROUND_SELECTOR)) return;
      onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [allowBackgroundInteraction, onClose, open, previewOpen]);

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

  const composedPrompt = composeThreeViewPrompt(threeView, promptBody);
  // The 三视图 chip alone is a valid prompt (the worker expands it); otherwise
  // there must be prompt text. Empty → Generate is disabled to block invalid requests.
  const hasPrompt = threeView || promptBody.trim().length > 0;
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
  const latestHistory = history[0] ?? null;
  const persistedPending = isResourceImagePending(latestHistory);
  const hasStyleIdentityReference = !isStyle || Boolean(identityReferenceAssetId);
  const generateBusy = generating || persistedPending;
  const generateDisabled = generateBusy || uploading || !hasPrompt || !hasStyleIdentityReference;
  const generateTitle = !hasPrompt
    ? '请先填写提示词或点击「三视图」'
    : !hasStyleIdentityReference
      ? '请先生成或上传角色头像'
      : undefined;
  const handleAutoFill = () => {
    if (isStyle) {
      setThreeView(true);
      return;
    }
    const auto = buildAutoPrompt();
    const parsed = parseThreeViewPrompt(auto);
    setThreeView(parsed.threeView);
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
    let effectiveThreeView = threeView;
    if (!effectivePromptBody && !effectiveThreeView) {
      const parsed = parseThreeViewPrompt(buildAutoPrompt());
      effectivePromptBody = parsed.body;
      effectiveThreeView = parsed.threeView;
    }
    const effectivePrompt = composeThreeViewPrompt(effectiveThreeView, effectivePromptBody);
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
        const fresh = await onSave({ assetId: final.outputAssets[0].id });
        if (isActiveGeneration()) {
          setImage(fresh.image || '');
          setAssetId(fresh.assetId ?? final.outputAssets[0].id);
          setGenerationPhase('idle');
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
      if (resourceKind) {
        await createResourceImage({
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
      setImage(fresh.image || '');
      setAssetId(fresh.assetId ?? asset.id);
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
      setImage(fresh.image || row.image || '');
      setAssetId(fresh.assetId ?? row.assetId);
      await refreshHistory(resourceKind, entity.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '设置当前图片失败');
    } finally {
      setHistoryBusy(null);
    }
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
  const persistedGenerationPhase = latestHistory?.status === 'QUEUED'
    ? 'queued'
    : latestHistory?.status === 'RUNNING'
      ? 'running'
      : generationPhase;
  const generationLabel = IMAGE_GENERATION_LABEL[
    generateBusy && persistedGenerationPhase === 'idle' ? 'queueing' : persistedGenerationPhase
  ];
  const persistedError = latestHistory?.status === 'FAILED' ? latestHistory.error : null;
  const visibleError = error || remoteError || persistedError;
  const hasPreviewImage = Boolean(image);
  const showPreviewBusyOverlay = (generateBusy || uploading) && !hasPreviewImage;
  const showPreviewBusyBadge = (generateBusy || uploading) && hasPreviewImage;
  const showPreviewErrorOverlay = Boolean(visibleError) && !generateBusy && !uploading && !hasPreviewImage;
  const showPreviewErrorBadge = Boolean(visibleError) && !generateBusy && !uploading && hasPreviewImage;

  return (
    <>
    <div
      className={`fixed inset-0 z-[1900] flex justify-end bg-black/30 ${
        allowBackgroundInteraction ? 'pointer-events-none' : ''
      }`}
      onClick={allowBackgroundInteraction ? undefined : onClose}
    >
      <div
        ref={drawerRef}
        className="pointer-events-auto w-[840px] max-w-[100vw] h-full bg-white shadow-2xl flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {resourceKind && (
          <HistoryRail
            history={history}
            loading={historyLoading}
            currentAssetId={assetId}
            identityReferenceAssetId={identityReferenceAssetId ?? null}
            busyId={historyBusy}
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
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image}
                    alt={name}
                    className="w-full h-full object-contain cursor-pointer"
                    onClick={() => setPreviewOpen(true)}
                  />
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
                      {generateBusy ? generationLabel || '生成中…' : '上传中…'}
                    </span>
                  </div>
                )}
                {showPreviewBusyBadge && (
                  <div className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {generateBusy ? generationLabel || '生成中…' : '上传中…'}
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
              <div className="px-4 py-3 border-b border-[var(--color-border)] flex flex-wrap items-center gap-2">
                <button
                  onClick={() => refFileRef.current?.click()}
                  disabled={generateBusy || uploading}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm hover:bg-gray-50 disabled:opacity-50"
                  title="上传本地图片作为 AI 生成参考"
                >
                  <Upload className="w-4 h-4" />
                  参考图
                </button>
                <button
                  onClick={handleAutoFill}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm hover:bg-gray-50"
                  title={
                    isStyle
                      ? '生成该角色的三视图（正/侧/背 + 大头）'
                      : '基于剧本 / 项目自动生成提示词'
                  }
                >
                  <Wand2 className="w-4 h-4" />
                  {isStyle ? '三视图' : '自动填充'}
                </button>
                {isStyle && (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs ${
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
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <X className="w-3.5 h-3.5" />
                    )}
                    {hasStyleIdentityReference ? '已绑定身份母版' : '缺少身份母版'}
                  </span>
                )}
                {referenceImageUrl && (
                  <div className="ml-auto flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={referenceImageUrl}
                      alt="参考图"
                      className="w-8 h-8 object-cover rounded-md border border-[var(--color-border)]"
                    />
                    <span className="text-xs text-[var(--color-text-secondary)]">已添加参考图</span>
                    <button
                      onClick={() => {
                        setReferenceAssetId(null);
                        setReferenceImageUrl('');
                      }}
                      className="w-5 h-5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 inline-flex items-center justify-center"
                      title="移除参考图"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
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
                <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                  提示词
                </label>
                <div className="mt-1.5 rounded-lg border border-[var(--color-border)] focus-within:border-[var(--color-primary)] focus-within:ring-1 focus-within:ring-[var(--color-primary)] overflow-hidden">
                  {threeView && (
                    <div className="flex items-center gap-1 px-3 pt-2">
                      <span
                        className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-xs font-medium"
                        title="生成时将自动渲染为三视图（正视图 + 3/4 侧视图 + 背视图 + 大头特写）"
                      >
                        {THREE_VIEW_MARKER}
                        <button
                          onClick={() => setThreeView(false)}
                          className="w-4 h-4 inline-flex items-center justify-center rounded hover:bg-[var(--color-primary)]/15"
                          aria-label="移除三视图标签"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    </div>
                  )}
                  <textarea
                    rows={5}
                    value={promptBody}
                    onChange={(e) => setPromptBody(e.target.value)}
                    placeholder={
                      isStyle
                        ? '描述这个造型。点击「三视图」可让模型输出标准三视图。'
                        : '描述你希望生成的画面。也可以点击「自动填充」由剧本上下文和项目风格自动生成。'
                    }
                    className="w-full px-3 py-2 outline-none text-sm resize-none font-mono leading-relaxed bg-transparent"
                  />
                </div>
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
                  {generateBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {generateBusy ? generationLabel || '生成中…' : image ? '重新生成' : '生成图片'}
                </button>
              </div>
              {generateBusy && generationLabel && (
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
      src={image}
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
  identityReferenceAssetId,
  busyId,
  onSetCurrent,
}: {
  history: ResourceImage[];
  loading: boolean;
  currentAssetId: string | null;
  identityReferenceAssetId: string | null;
  busyId: string | null;
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
            const pending = row.status === 'QUEUED' || row.status === 'RUNNING';
            const failed = row.status === 'FAILED';
            const selected = Boolean(row.assetId && row.assetId === currentAssetId);
            const usedIdentityReference = Boolean(
              row.identityReferenceAssetId &&
                row.identityReferenceAssetId === identityReferenceAssetId,
            );
            return (
              <button
                key={row.id}
                onClick={() => {
                  if (row.assetId) onSetCurrent(row);
                }}
                disabled={!row.assetId || pending || busyId === row.id}
                className={`relative w-full aspect-square rounded-lg overflow-hidden border transition-colors ${
                  selected
                    ? 'border-[var(--color-primary)]'
                    : failed
                      ? 'border-red-200'
                      : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'
                } disabled:cursor-default`}
                title={
                  failed
                    ? row.error || '生成失败'
                    : usedIdentityReference
                      ? '使用身份母版生成'
                      : row.source === 'upload'
                        ? '上传图片'
                        : '生成历史'
                }
              >
                {row.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                    {pending || busyId === row.id ? (
                      <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                    ) : failed ? (
                      <X className="w-4 h-4 text-red-500" />
                    ) : (
                      <ImagePlus className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                )}
                {selected && (
                  <span className="absolute right-1 top-1 w-4 h-4 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center">
                    <Check className="w-3 h-3" />
                  </span>
                )}
                {usedIdentityReference && (
                  <span className="absolute left-1 bottom-1 px-1 rounded bg-black/55 text-[9px] font-semibold leading-4 text-white">
                    ID
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
