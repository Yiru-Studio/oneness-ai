'use client';

import { useState } from 'react';
import { Trash2, Loader2, Play, Image as ImageIcon, Plus, RotateCcw, X } from 'lucide-react';
import { Shot, Character, Scene, Item, CompositionTask } from '@/types';
import { ImagePreview } from '@/components/ImagePreview';
import { ReferencePickerDialog } from './ReferencePickerDialog';

// Models we actually have registered in the worker registry. Adding more is
// a backend change — DO NOT add cosmetic-only options here.
export const VIDEO_MODEL_OPTIONS = [
  { value: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0 Pro' },
  { value: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast' },
  { value: 'stub/placeholder', label: '测试 Stub' },
] as const;

function normalizeVideoModelValue(model: string): string {
  if (model === 'seedance') return 'doubao-seedance-2-0-260128';
  if (model === 'seedance-fast') return 'doubao-seedance-2-0-fast-260128';
  if (model === 'stub') return 'stub/placeholder';
  return model;
}

export const SHOT_TYPE_OPTIONS = [
  { value: 'new', label: '全新镜头' },
  { value: 'continuation', label: '续写镜头' },
] as const;

export const RESOLUTION_OPTIONS = ['480p', '720p', '1080p'] as const;
export const RATIO_OPTIONS = ['16:9', '9:16', '1:1'] as const;
export const DURATION_OPTIONS = [3, 4, 5, 6, 8, 10, 12, 15] as const;

interface Props {
  shot: Shot;
  characters: Character[];
  scenes: Scene[];
  items: Item[];
  compositionTasks: CompositionTask[];
  /** displayId of every other shot in the episode, for the "续写镜头" preId picker. */
  siblingDisplayIds: number[];
  busy: boolean;
  onUpdate: (id: string, patch: Partial<Shot>, options?: { rethrow?: boolean }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onGenerate: (id: string, beforeGeneratePatch?: Partial<Shot>) => Promise<void>;
}

type ResourceThumb = { key: string; label: string; url: string | null };

export function ShotCard({
  shot,
  characters,
  scenes,
  items,
  compositionTasks,
  siblingDisplayIds,
  busy,
  onUpdate,
  onDelete,
  onGenerate,
}: Props) {
  const [promptDraft, setPromptDraft] = useState(() => ({
    shotId: shot.id,
    sourcePrompt: shot.prompt,
    value: shot.prompt,
  }));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewThumb, setPreviewThumb] = useState<{ src: string; alt: string } | null>(null);
  const prompt =
    promptDraft.shotId === shot.id && promptDraft.sourcePrompt === shot.prompt
      ? promptDraft.value
      : shot.prompt;

  const isGenerating =
    shot.videoTaskStatus === 'QUEUED' || shot.videoTaskStatus === 'RUNNING';
  const isSketchGenerating =
    shot.sketchTaskStatus === 'QUEUED' || shot.sketchTaskStatus === 'RUNNING';
  const sketchFailed = shot.sketchTaskStatus === 'FAILED' && !shot.sketch;
  const promptReady = prompt.trim().length > 0;

  const handlePromptBlur = () => {
    if (prompt === shot.prompt) return;
    void onUpdate(shot.id, { prompt }, { rethrow: true }).catch(() => {
      setPromptDraft({ shotId: shot.id, sourcePrompt: shot.prompt, value: shot.prompt });
    });
  };

  // Build the list of resource thumbnails (sketch + composition shots + resources).
  const resourceThumbs = buildResourceThumbs(shot, characters, scenes, items, compositionTasks);
  const hasSelectedReference = resourceThumbs.length > 0;
  const hasVideoReference = resourceThumbs.some((r) => Boolean(r.url));
  const videoDisabledReason = !promptReady
    ? '请先填写视频提示词'
    : !hasSelectedReference
      ? '请先选择草图或参考资产'
      : !hasVideoReference
        ? '请选择带图片的参考资产'
      : null;
  const sketchThumb = resourceThumbs.find((r) => r.key === `sketch-${shot.id}`) ?? null;
  const referenceThumbs = resourceThumbs.filter((r) => r.key !== `sketch-${shot.id}`);
  const editingDisabled = busy || isGenerating;
  const handleRemoveReference = (thumb: ResourceThumb) => {
    if (editingDisabled) return;
    if (thumb.key.startsWith('ct-')) {
      const id = thumb.key.slice(3);
      void onUpdate(shot.id, {
        compositionTaskIds: shot.compositionTaskIds.filter((taskId) => taskId !== id),
      });
      return;
    }
    if (thumb.key.startsWith('cs-')) {
      const id = thumb.key.slice(3);
      void onUpdate(shot.id, {
        characterStyleIds: shot.characterStyleIds.filter((styleId) => styleId !== id),
      });
      return;
    }
    if (thumb.key.startsWith('sc-')) {
      const id = thumb.key.slice(3);
      void onUpdate(shot.id, { sceneIds: shot.sceneIds.filter((sceneId) => sceneId !== id) });
      return;
    }
    if (thumb.key.startsWith('it-')) {
      const id = thumb.key.slice(3);
      void onUpdate(shot.id, { itemIds: shot.itemIds.filter((itemId) => itemId !== id) });
    }
  };
  const handleGenerate = async () => {
    const beforeGeneratePatch = prompt !== shot.prompt ? { prompt } : undefined;
    try {
      await onGenerate(shot.id, beforeGeneratePatch);
    } catch {
      if (beforeGeneratePatch) {
        setPromptDraft({ shotId: shot.id, sourcePrompt: shot.prompt, value: shot.prompt });
      }
    }
  };

  return (
    <div className="rounded-[22px] border border-[var(--color-border)] bg-white p-5 shadow-sm">
      <ShotControlBar
        shot={shot}
        siblingDisplayIds={siblingDisplayIds}
        busy={editingDisabled}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />

      <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          <textarea
            value={prompt}
            onChange={(e) =>
              setPromptDraft({
                shotId: shot.id,
                sourcePrompt: shot.prompt,
                value: e.target.value,
              })
            }
            onBlur={handlePromptBlur}
            disabled={editingDisabled}
            rows={6}
            placeholder="景别 + 运镜方式 + 视角 + 画面内容及运动方式（@角色 / @物品 / @场景 可引用）+ 效果提示词（光影/色调/构图/细节）"
            className="min-h-[164px] w-full resize-none rounded-[20px] border border-transparent bg-gray-50 px-5 py-4 text-[15px] leading-7 text-gray-800 outline-none transition-colors placeholder:text-gray-400 focus:border-[var(--color-primary)] focus:bg-white focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
          />

          <ReferenceAssetCards
            sketchThumb={sketchThumb}
            referenceThumbs={referenceThumbs}
            isSketchGenerating={isSketchGenerating}
            sketchFailed={sketchFailed}
            busy={editingDisabled}
            onAddReference={() => setPickerOpen(true)}
            onPreview={(thumb) => setPreviewThumb({ src: thumb.url!, alt: thumb.label })}
            onRemoveReference={handleRemoveReference}
          />
        </div>

        <VideoGeneratePanel
          shot={shot}
          busy={busy}
          isGenerating={isGenerating}
          videoDisabledReason={videoDisabledReason}
          onGenerate={handleGenerate}
        />
      </div>

      <ReferencePickerDialog
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        characters={characters}
        scenes={scenes}
        items={items}
        compositionTasks={compositionTasks}
        selected={{
          compositionTaskIds: shot.compositionTaskIds,
          characterStyleIds: shot.characterStyleIds,
          sceneIds: shot.sceneIds,
          itemIds: shot.itemIds,
        }}
        onConfirm={(next) => onUpdate(shot.id, next, { rethrow: true })}
      />
      <ImagePreview
        src={previewThumb?.src ?? ''}
        alt={previewThumb?.alt}
        open={Boolean(previewThumb)}
        onClose={() => setPreviewThumb(null)}
      />
    </div>
  );
}

function ShotControlBar({
  shot,
  siblingDisplayIds,
  busy,
  onUpdate,
  onDelete,
}: {
  shot: Shot;
  siblingDisplayIds: number[];
  busy: boolean;
  onUpdate: (id: string, patch: Partial<Shot>, options?: { rethrow?: boolean }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-dark)] text-base font-semibold text-white">
        {shot.displayId}
      </div>

      <Select
        value={shot.shotType}
        options={SHOT_TYPE_OPTIONS}
        onChange={(v) =>
          onUpdate(shot.id, {
            shotType: v as 'new' | 'continuation',
            preId: v === 'new' ? null : shot.preId,
          })
        }
        disabled={busy}
      />

      {shot.shotType === 'continuation' && (
        <select
          value={shot.preId ?? ''}
          onChange={(e) => {
            const next = e.target.value ? Number(e.target.value) : null;
            void onUpdate(shot.id, { preId: next });
          }}
          disabled={busy}
          className="h-10 rounded-full border border-[var(--color-border)] bg-gray-50 px-4 text-sm font-medium text-gray-800 outline-none transition-colors hover:border-gray-300 focus:border-[var(--color-primary)] focus:bg-white disabled:opacity-60"
        >
          <option value="">从…续写</option>
          {siblingDisplayIds
            .filter((d) => d !== shot.displayId)
            .map((d) => (
              <option key={d} value={d}>
                续写 #{d}
              </option>
            ))}
        </select>
      )}

      <div className="flex h-10 items-center rounded-full bg-gray-50">
        <select
          value={shot.duration}
          onChange={(e) => onUpdate(shot.id, { duration: Number(e.target.value) })}
          disabled={busy}
          className="h-10 rounded-full border border-transparent bg-transparent pl-4 pr-8 text-sm font-medium text-gray-800 outline-none transition-colors focus:border-[var(--color-primary)] focus:bg-white disabled:opacity-60"
        >
          {DURATION_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <span className="pr-4 text-sm text-gray-500">秒</span>
      </div>

      <Select
        value={normalizeVideoModelValue(shot.model)}
        options={VIDEO_MODEL_OPTIONS}
        onChange={(v) => onUpdate(shot.id, { model: v })}
        disabled={busy}
      />

      <Select
        value={shot.ratio}
        options={RATIO_OPTIONS.map((r) => ({ value: r, label: r }))}
        onChange={(v) => onUpdate(shot.id, { ratio: v })}
        disabled={busy}
      />

      <Select
        value={shot.resolution}
        options={RESOLUTION_OPTIONS.map((r) => ({ value: r, label: r }))}
        onChange={(v) => onUpdate(shot.id, { resolution: v })}
        disabled={busy}
      />

      <label className="flex h-10 items-center gap-2 rounded-full bg-gray-50 px-4 text-sm font-medium text-gray-600">
        <input
          type="checkbox"
          checked={shot.generateAudio}
          onChange={(e) => onUpdate(shot.id, { generateAudio: e.target.checked })}
          disabled={busy}
          className="accent-[var(--color-primary)]"
        />
        音画同出
      </label>

      <button
        type="button"
        onClick={() => onDelete(shot.id)}
        disabled={busy}
        title="删除分镜"
        className="ml-auto flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function ReferenceAssetCards({
  sketchThumb,
  referenceThumbs,
  isSketchGenerating,
  sketchFailed,
  busy,
  onAddReference,
  onPreview,
  onRemoveReference,
}: {
  sketchThumb: ResourceThumb | null;
  referenceThumbs: ResourceThumb[];
  isSketchGenerating: boolean;
  sketchFailed: boolean;
  busy: boolean;
  onAddReference: () => void;
  onPreview: (thumb: ResourceThumb) => void;
  onRemoveReference: (thumb: ResourceThumb) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => {
          if (sketchThumb?.url) onPreview(sketchThumb);
        }}
        disabled={!sketchThumb?.url}
        className="group relative h-[136px] w-[136px] overflow-hidden rounded-[18px] border border-[var(--color-border)] bg-gray-50 text-gray-500 transition-colors enabled:cursor-zoom-in enabled:hover:border-[var(--color-primary)] disabled:cursor-default"
        aria-label={sketchThumb?.url ? '查看场景图' : '场景图未生成'}
      >
        {sketchThumb?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sketchThumb.url} alt="场景图" className="h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-sm font-medium">
            {isSketchGenerating ? (
              <span className="inline-flex items-center gap-2 text-[var(--color-primary)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                生成中
              </span>
            ) : sketchFailed ? (
              <span className="text-red-500">未生成</span>
            ) : (
              '未生成'
            )}
          </div>
        )}
        <span className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-center text-sm font-semibold text-white">
          场景图
        </span>
      </button>

      {referenceThumbs.map((thumb) => (
        <div
          key={thumb.key}
          className="group relative h-[136px] w-[136px] overflow-hidden rounded-[18px] border border-[var(--color-border)] bg-gray-50 text-gray-400 transition-colors hover:border-[var(--color-primary)]"
          title={thumb.label}
        >
          <button
            type="button"
            onClick={() => {
              if (thumb.url) onPreview(thumb);
            }}
            disabled={!thumb.url}
            className="absolute inset-0 enabled:cursor-zoom-in disabled:cursor-default"
            aria-label={thumb.url ? `查看${thumb.label}` : thumb.label}
          >
            {thumb.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb.url} alt={thumb.label} className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="absolute inset-0 m-auto h-6 w-6" />
            )}
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-3 py-2 text-center text-sm font-semibold text-white">
              {thumb.label}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onRemoveReference(thumb)}
            disabled={busy}
            className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-100 shadow-sm transition-opacity hover:bg-red-500 focus:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] disabled:opacity-40 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
            aria-label={`移除${thumb.label}`}
            title={`移除${thumb.label}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={onAddReference}
        disabled={busy}
        className="flex h-[136px] w-[136px] items-center justify-center rounded-[18px] border border-dashed border-gray-300 bg-gray-50 text-gray-800 transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
        aria-label="选择参考资产"
      >
        <Plus className="h-8 w-8" />
      </button>
    </div>
  );
}

function VideoGeneratePanel({
  shot,
  busy,
  isGenerating,
  videoDisabledReason,
  onGenerate,
}: {
  shot: Shot;
  busy: boolean;
  isGenerating: boolean;
  videoDisabledReason: string | null;
  onGenerate: () => Promise<void>;
}) {
  const disabled = busy || isGenerating || Boolean(videoDisabledReason);
  const isFailed = shot.videoTaskStatus === 'FAILED';
  const label = shot.video?.url ? '重新生成' : '点击生成';

  return (
    <div className="flex min-h-[320px] flex-col">
      {shot.video?.url ? (
        <div className="aspect-video overflow-hidden rounded-[20px] bg-black">
          <video src={shot.video.url} controls className="h-full w-full" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void onGenerate()}
          disabled={disabled}
          className="flex min-h-[300px] flex-1 flex-col items-center justify-center gap-4 rounded-[24px] border-2 border-dashed border-gray-300 bg-gray-50 px-6 text-center text-gray-600 transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:hover:border-gray-300 disabled:hover:text-gray-600"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-11 w-11 animate-spin" />
              <span className="text-base font-semibold">
                {shot.videoTaskStatus === 'QUEUED' ? '排队中…' : '生成中…'}
              </span>
            </>
          ) : (
            <>
              <span className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-current">
                <Play className="ml-1 h-8 w-8 fill-current" />
              </span>
              <span className="text-lg font-semibold">{label}</span>
            </>
          )}
        </button>
      )}

      {shot.video?.url && (
        <button
          type="button"
          onClick={() => void onGenerate()}
          disabled={disabled}
          className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          重新生成视频
        </button>
      )}

      {!isGenerating && videoDisabledReason && (
        <div className="mt-3 text-center text-xs text-gray-500">{videoDisabledReason}</div>
      )}
      {isGenerating && (
        <div className="mt-3 text-center text-xs text-gray-500">
          生成中，当前参数和参考已锁定
        </div>
      )}
      {isFailed && (
        <div className="mt-3 text-center text-xs text-red-600">上次生成失败，可重试。</div>
      )}
    </div>
  );
}

function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string } | T>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) =>
        onChange(
          (typeof value === 'number' ? Number(e.target.value) : e.target.value) as T,
        )
      }
      disabled={disabled}
      className="h-10 rounded-full border border-[var(--color-border)] bg-gray-50 px-4 text-sm font-medium text-gray-800 outline-none transition-colors hover:border-gray-300 focus:border-[var(--color-primary)] focus:bg-white disabled:opacity-60"
    >
      {options.map((o) => {
        const opt = typeof o === 'object' ? o : { value: o, label: String(o) };
        return (
          <option key={String(opt.value)} value={String(opt.value)}>
            {opt.label}
          </option>
        );
      })}
    </select>
  );
}

function buildResourceThumbs(
  shot: Shot,
  characters: Character[],
  scenes: Scene[],
  items: Item[],
  compositionTasks: CompositionTask[],
): ResourceThumb[] {
  const out: ResourceThumb[] = [];
  if (shot.sketch) {
    out.push({ key: `sketch-${shot.id}`, label: '分镜首帧', url: shot.sketch.url });
  }
  for (const taskId of shot.compositionTaskIds) {
    const task = compositionTasks.find((t) => t.id === taskId);
    if (task) {
      out.push({
        key: `ct-${taskId}`,
        label: `合成镜头：${task.title}`,
        url: task.image?.url ?? null,
      });
    }
  }
  for (const sid of shot.characterStyleIds) {
    const c = characters.find((c) => c.styles.some((s) => s.id === sid));
    if (!c) continue;
    const style = c.styles.find((s) => s.id === sid)!;
    out.push({
      key: `cs-${sid}`,
      label: `${c.name} - ${style.name}`,
      url: style.image || null,
    });
  }
  for (const sid of shot.sceneIds) {
    const sc = scenes.find((s) => s.id === sid);
    if (sc) out.push({ key: `sc-${sid}`, label: sc.name, url: sc.image || null });
  }
  for (const iid of shot.itemIds) {
    const it = items.find((s) => s.id === iid);
    if (it) out.push({ key: `it-${iid}`, label: it.name, url: it.image || null });
  }
  return out;
}
