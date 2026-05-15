'use client';

import { useEffect, useRef, useState } from 'react';
import {
  X,
  Sparkles,
  Upload,
  Loader2,
  Trash2,
  ImagePlus,
  Save,
  Wand2,
} from 'lucide-react';
import { Project } from '@/types';
import {
  uploadAsset,
  createImageTask,
  pollTaskUntilDone,
} from '@/lib/api';
import {
  IMAGE_MODEL_OPTIONS,
  imageProviderForModel,
} from '@/data/style-presets';

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
};

interface Props {
  open: boolean;
  kind: EntityKind;
  /** Entity being edited. Always provides an `id`; image may be empty. */
  entity: EntityDetailData;
  project: Project;
  /** When provided, the character's avatar is sent as a reference image
   *  during generation to maintain visual consistency. */
  characterId?: string;
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

const DEFAULT_RATIO_BY_KIND: Record<EntityKind, string> = {
  item: '1:1',
  scene: '16:9',
  style: '9:16',
  'character-avatar': '1:1',
};

export function EntityDetailDrawer({
  open,
  kind,
  entity,
  project,
  characterId,
  buildAutoPrompt,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [name, setName] = useState(entity.name);
  const [description, setDescription] = useState(entity.description ?? '');
  const initialParsed = parseThreeViewPrompt(entity.prompt ?? '');
  const [promptBody, setPromptBody] = useState(initialParsed.body);
  const [threeView, setThreeView] = useState(initialParsed.threeView);
  const [model, setModel] = useState(entity.model || project.imageModel);
  const [ratio, setRatio] = useState(
    entity.ratio || (kind === 'scene' ? project.ratio : DEFAULT_RATIO_BY_KIND[kind]),
  );
  const [image, setImage] = useState(entity.image || '');
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset state when the entity changes.
  useEffect(() => {
    setName(entity.name);
    setDescription(entity.description ?? '');
    const parsed = parseThreeViewPrompt(entity.prompt ?? '');
    setPromptBody(parsed.body);
    setThreeView(parsed.threeView);
    setModel(entity.model || project.imageModel);
    setRatio(
      entity.ratio || (kind === 'scene' ? project.ratio : DEFAULT_RATIO_BY_KIND[kind]),
    );
    setImage(entity.image || '');
    setError(null);
  }, [entity.id, entity.name, entity.description, entity.prompt, entity.model, entity.ratio, entity.image, project.imageModel, project.ratio, kind]);

  if (!open) return null;

  const composedPrompt = composeThreeViewPrompt(threeView, promptBody);
  const dirty =
    name !== entity.name ||
    description !== (entity.description ?? '') ||
    composedPrompt !== (entity.prompt ?? '') ||
    model !== (entity.model || project.imageModel) ||
    ratio !== (entity.ratio || (kind === 'scene' ? project.ratio : DEFAULT_RATIO_BY_KIND[kind]));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const fresh = await onSave({
        name: name.trim() || entity.name,
        description,
        prompt: composedPrompt,
        model,
        ratio,
      });
      setImage(fresh.image || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const isStyle = kind === 'style';

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

  const handleGenerate = async () => {
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
    setGenerating(true);
    setError(null);
    try {
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
          ...(characterId ? { characterId } : {}),
        },
        imageProviderForModel(model || project.imageModel),
      );
      const final = await pollTaskUntilDone(task.id, { intervalMs: 2000 });
      if (final.status !== 'SUCCEEDED' || !final.outputAssets?.[0]) {
        throw new Error(final.error || '生成失败');
      }
      const fresh = await onSave({ assetId: final.outputAssets[0].id });
      setImage(fresh.image || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const asset = await uploadAsset(file);
      const fresh = await onSave({ assetId: asset.id });
      setImage(fresh.image || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!confirm(`确认删除该${KIND_LABEL[kind]}？此操作不可撤销。`)) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
      setDeleting(false);
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

  return (
    <div className="fixed inset-0 z-[1900] flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-[760px] max-w-[100vw] h-full bg-white shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-white border-b border-[var(--color-border)] px-6 py-4 flex items-center justify-between">
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
          </div>

          <div className="flex items-center gap-2 ml-2 flex-shrink-0">
            {onDelete && (
              <button
                onClick={handleDelete}
                disabled={deleting || saving || generating || uploading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                title={`删除${KIND_LABEL[kind]}`}
              >
                {deleting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                删除
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              保存
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Image preview */}
          <div
            className={`${aspectClass} w-full max-h-[60vh] rounded-xl overflow-hidden bg-gray-100 relative flex items-center justify-center`}
          >
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt={name} className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center text-gray-400">
                <ImagePlus className="w-12 h-12" />
                <span className="text-xs mt-2">尚未生成图片</span>
              </div>
            )}
            {(generating || uploading) && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white">
                <Loader2 className="w-7 h-7 animate-spin" />
                <span className="ml-2 text-sm">
                  {generating ? '生成中…' : '上传中…'}
                </span>
              </div>
            )}
          </div>

          {/* Action row */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleGenerate}
              disabled={generating || uploading || saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {image ? '重新生成' : '生成图片'}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={generating || uploading || saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              上传本地图片
            </button>
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
          </div>

          {/* Prompt editor */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                提示词
              </label>
              <button
                onClick={handleAutoFill}
                className="text-xs text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
                title={
                  isStyle
                    ? '生成该角色的三视图（正/侧/背 + 大头）'
                    : '基于剧本 / 项目自动生成提示词'
                }
              >
                <Wand2 className="w-3 h-3" />
                {isStyle ? '三视图' : '自动填充'}
              </button>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] focus-within:border-[var(--color-primary)] focus-within:ring-1 focus-within:ring-[var(--color-primary)] overflow-hidden">
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
                rows={8}
                value={promptBody}
                onChange={(e) => setPromptBody(e.target.value)}
                placeholder={
                  isStyle
                    ? '描述这个造型。点击右上「三视图」可让模型输出标准三视图。'
                    : '描述你希望生成的画面。也可以点击右上「自动填充」由剧本上下文+项目风格自动生成。'
                }
                className="w-full px-3 py-2 outline-none text-sm resize-none font-mono leading-relaxed bg-transparent"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              备注 / 描述
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`${KIND_LABEL[kind]}的中文描述（仅自己可见，不参与生成）`}
              className="mt-1.5 w-full px-3 py-2 rounded-lg border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none text-sm resize-none"
            />
          </div>

          {/* Model + ratio */}
          <div className="grid grid-cols-2 gap-3">
            <div>
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
            <div>
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
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
      </div>
    </div>
  );
}
