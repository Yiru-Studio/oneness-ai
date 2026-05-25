'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2, Loader2, Play, Image as ImageIcon, Plus, RotateCcw } from 'lucide-react';
import { Shot, Character, Scene, Item } from '@/types';
import { ImagePreview } from '@/components/ImagePreview';
import { ReferencePickerDialog } from './ReferencePickerDialog';

// Models we actually have registered in the worker registry. Adding more is
// a backend change — DO NOT add cosmetic-only options here.
export const VIDEO_MODEL_OPTIONS = [
  { value: 'seedance', label: 'Seedance 2.0' },
  { value: 'seedance-fast', label: 'Seedance 2.0 Fast' },
  { value: 'stub', label: '测试 Stub' },
] as const;

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
  /** displayId of every other shot in the episode, for the "续写镜头" preId picker. */
  siblingDisplayIds: number[];
  busy: boolean;
  onUpdate: (id: string, patch: Partial<Shot>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onGenerate: (id: string) => Promise<void>;
}

export function ShotCard({
  shot,
  characters,
  scenes,
  items,
  siblingDisplayIds,
  busy,
  onUpdate,
  onDelete,
  onGenerate,
}: Props) {
  const [prompt, setPrompt] = useState(shot.prompt);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewThumb, setPreviewThumb] = useState<{ src: string; alt: string } | null>(null);
  const savedPromptRef = useRef(shot.prompt);

  useEffect(() => {
    setPrompt(shot.prompt);
    savedPromptRef.current = shot.prompt;
  }, [shot.id, shot.prompt]);

  const isGenerating =
    shot.videoTaskStatus === 'QUEUED' || shot.videoTaskStatus === 'RUNNING';
  const isSketchGenerating =
    shot.sketchTaskStatus === 'QUEUED' || shot.sketchTaskStatus === 'RUNNING';
  const sketchFailed = shot.sketchTaskStatus === 'FAILED' && !shot.sketch;
  const promptReady = prompt.trim().length > 0;

  const handlePromptBlur = () => {
    if (prompt === savedPromptRef.current) return;
    savedPromptRef.current = prompt;
    void onUpdate(shot.id, { prompt });
  };

  // Build the list of resource thumbnails (sketch + characters + scenes + items).
  const resourceThumbs = buildResourceThumbs(shot, characters, scenes, items);
  const hasVideoReference = resourceThumbs.length > 0;
  const videoDisabledReason = !promptReady
    ? '请先填写视频提示词'
    : !hasVideoReference
      ? '请先选择草图或参考资产'
      : null;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-gray-50">
        <div className="w-7 h-7 rounded-full bg-[var(--color-dark)] text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
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
            className="px-2 py-1 rounded-md border border-[var(--color-border)] text-xs bg-white"
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

        <div className="flex items-center gap-1">
          <select
            value={shot.duration}
            onChange={(e) => onUpdate(shot.id, { duration: Number(e.target.value) })}
            disabled={busy}
            className="px-2 py-1 rounded-md border border-[var(--color-border)] text-xs bg-white"
          >
            {DURATION_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500">秒</span>
        </div>

        <Select
          value={shot.model}
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

        <label className="flex items-center gap-1 text-xs text-gray-600">
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
          onClick={() => onDelete(shot.id)}
          disabled={busy}
          title="删除分镜"
          className="ml-auto w-7 h-7 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body: content + resources (left) | video preview (right) */}
      <div className="grid grid-cols-[1fr_320px] gap-4 p-4">
        <div className="min-w-0">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={handlePromptBlur}
            disabled={busy}
            rows={6}
            placeholder="景别 + 运镜方式 + 视角 + 画面内容及运动方式（@角色 / @物品 / @场景 可引用）+ 效果提示词（光影/色调/构图/细节）"
            className="w-full rounded-lg border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none px-3 py-2 text-sm font-mono leading-relaxed resize-y"
          />

          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-[var(--color-text-secondary)]">参考资产</span>
              <div className="flex items-center gap-2">
                {isSketchGenerating && (
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--color-primary)]">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    合成镜头图生成中
                  </span>
                )}
                {sketchFailed && (
                  <span className="text-xs text-red-500">合成镜头图生成失败</span>
                )}
                <button
                  onClick={() => setPickerOpen(true)}
                  disabled={busy}
                  className="text-xs text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  选择参考
                </button>
              </div>
            </div>
            {resourceThumbs.length === 0 && isSketchGenerating ? (
              <div className="text-xs text-[var(--color-primary)] px-3 py-4 border border-dashed border-blue-200 bg-blue-50 rounded-lg text-center inline-flex items-center justify-center gap-2 w-full">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                合成镜头图生成中…
              </div>
            ) : resourceThumbs.length === 0 ? (
              <div className="text-xs text-gray-400 px-3 py-4 border border-dashed border-[var(--color-border)] rounded-lg text-center">
                {sketchFailed ? '合成镜头图生成失败，可重新触发智能分镜创作' : '未选择任何参考资产'}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {resourceThumbs.map((r) => (
                  <button
                    type="button"
                    key={r.key}
                    onClick={() => {
                      if (r.url) setPreviewThumb({ src: r.url, alt: r.label });
                    }}
                    disabled={!r.url}
                    className="w-16 h-16 rounded-lg overflow-hidden border border-[var(--color-border)] bg-gray-100 relative disabled:cursor-default enabled:cursor-zoom-in enabled:hover:border-[var(--color-primary)] enabled:focus-visible:outline enabled:focus-visible:outline-2 enabled:focus-visible:outline-offset-2 enabled:focus-visible:outline-[var(--color-primary)]"
                    title={r.label}
                    aria-label={r.url ? `查看${r.label}` : r.label}
                  >
                    {r.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.url} alt={r.label} className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="w-4 h-4 text-gray-400 absolute inset-0 m-auto" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="aspect-video rounded-lg bg-black/95 overflow-hidden relative">
            {shot.video?.url ? (
              <video src={shot.video.url} controls className="w-full h-full" />
            ) : isGenerating ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-xs gap-2">
                <Loader2 className="w-6 h-6 animate-spin" />
                {shot.videoTaskStatus === 'QUEUED' ? '排队中…' : '生成中…'}
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs">
                视频未生成
              </div>
            )}
          </div>
          <button
            onClick={() => onGenerate(shot.id)}
            disabled={busy || isGenerating || Boolean(videoDisabledReason)}
            className="px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                生成中
              </>
            ) : shot.video?.url ? (
              <>
                <RotateCcw className="w-3.5 h-3.5" />
                重新生成视频
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                生成视频
              </>
            )}
          </button>
          {!isGenerating && videoDisabledReason && (
            <div className="text-xs text-gray-500 text-center">{videoDisabledReason}</div>
          )}
          {shot.videoTaskStatus === 'FAILED' && (
            <div className="text-xs text-red-600 text-center">上次生成失败，可重试。</div>
          )}
        </div>
      </div>

      <ReferencePickerDialog
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        characters={characters}
        scenes={scenes}
        items={items}
        selected={{
          characterStyleIds: shot.characterStyleIds,
          sceneIds: shot.sceneIds,
          itemIds: shot.itemIds,
        }}
        onConfirm={(next) => onUpdate(shot.id, next)}
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
      className="px-2 py-1 rounded-md border border-[var(--color-border)] text-xs bg-white"
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
): Array<{ key: string; label: string; url: string | null }> {
  const out: Array<{ key: string; label: string; url: string | null }> = [];
  if (shot.sketch) {
    out.push({ key: `sketch-${shot.id}`, label: '合成镜头图', url: shot.sketch.url });
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
