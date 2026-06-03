'use client';

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';
import { X, Check, Loader2, Image as ImageIcon, ImagePlus } from 'lucide-react';
import { Character, CompositionTask, Item, Project, ResourceImageStatus, Scene } from '@/types';
import { EntityDetailDrawer, type EntityDetailData } from '@/components/projects/EntityDetailDrawer';
import { updateCharacterStyle } from '@/lib/api';
import { buildResourceImagePrompt } from '@oneness/shared/resource-prompts';
import { useGeneration } from '@/contexts/GenerationContext';
import { getGenerationErrorDisplay } from '@/lib/generation-error';
import { isTaskPending, taskPendingLabel } from '@/lib/task-status';

type PickerTab = 'composition' | 'characters' | 'scenes' | 'items';

type PickerOption = {
  id: string;
  label: string;
  sub?: string;
  thumb: string | null;
  badge?: string;
  emptyTitle?: string;
  emptyText?: string;
  resourceStatus?: ResourceImageStatus | null;
  resourceError?: string | null;
  styleEditor?: CharacterStyleEditor;
};

type CharacterStyleGroup = {
  id: string;
  label: string;
  options: PickerOption[];
};

type CharacterStyle = Character['styles'][number];

type CharacterStyleEditor = {
  character: Character;
  style: CharacterStyle & { id: string };
};

function characterStylePickerLabel(styleName: string, characterName: string, index: number) {
  const normalizedStyleName = styleName.trim();
  if (!normalizedStyleName || normalizedStyleName === characterName.trim()) {
    return index === 0 ? '默认造型' : `造型 ${index + 1}`;
  }
  return normalizedStyleName;
}

function isResourceImagePending(status: ResourceImageStatus | null | undefined): boolean {
  return isTaskPending(status);
}

function resourceStatusLabel(status: ResourceImageStatus | null | undefined): string {
  return taskPendingLabel(status) ?? '生成中';
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  characters: Character[];
  items: Item[];
  scenes: Scene[];
  compositionTasks: CompositionTask[];
  project: Project;
  selected: {
    compositionTaskIds: string[];
    characterStyleIds: string[];
    sceneIds: string[];
    itemIds: string[];
  };
  onRefreshReferences: () => Promise<void>;
  onConfirm: (next: {
    compositionTaskIds: string[];
    characterStyleIds: string[];
    sceneIds: string[];
    itemIds: string[];
  }) => void | Promise<void>;
}

/**
 * One dialog that lets the user pick composition shots, character styles,
 * scenes, and items to attach to a shot as reference images. Each selected ID
 * becomes a `reference_image` in the Seedance call. Picking a *character*
 * picks a character STYLE row (which is what carries an assetId).
 */
export function ReferencePickerDialog({
  isOpen,
  onClose,
  characters,
  items,
  scenes,
  compositionTasks,
  project,
  selected,
  onRefreshReferences,
  onConfirm,
}: Props) {
  const [tab, setTab] = useState<PickerTab>('composition');
  const [compositionTaskIds, setCompositionTaskIds] = useState<string[]>(
    selected.compositionTaskIds,
  );
  const [styleIds, setStyleIds] = useState<string[]>(selected.characterStyleIds);
  const [sceneIds, setSceneIds] = useState<string[]>(selected.sceneIds);
  const [itemIds, setItemIds] = useState<string[]>(selected.itemIds);
  const [previewOption, setPreviewOption] = useState<PickerOption | null>(null);
  const [editingStyle, setEditingStyle] = useState<CharacterStyleEditor | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const { isGenerating, getError } = useGeneration();
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setCompositionTaskIds(selected.compositionTaskIds);
    setStyleIds(selected.characterStyleIds);
    setSceneIds(selected.sceneIds);
    setItemIds(selected.itemIds);
    setPreviewOption(null);
    setEditingStyle(null);
    setConfirmError(null);
    setIsConfirming(false);
    setTab('composition');
  }, [
    isOpen,
    selected.compositionTaskIds,
    selected.characterStyleIds,
    selected.sceneIds,
    selected.itemIds,
  ]);
  if (!isOpen) return null;

  const characterGroups: CharacterStyleGroup[] = characters
    .map((c) => ({
      id: c.id,
      label: c.name,
      options: c.styles
        .filter((s) => Boolean(s.id))
        .map((s, index) => ({
          id: s.id as string,
          label: characterStylePickerLabel(s.name, c.name, index),
          sub: c.name,
          thumb: s.image || null,
          badge: s.image ? '造型图' : '待生成',
          emptyTitle: '暂无造型图',
          emptyText: '请先生成图片后再添加',
          resourceStatus: s.styleResourceImage?.status ?? null,
          resourceError: s.styleResourceImage?.error ?? null,
          styleEditor: {
            character: c,
            style: { ...s, id: s.id as string },
          },
        })),
    }))
    .filter((group) => group.options.length > 0);
  const characterOptions = characterGroups.flatMap((group) => group.options);
  const sceneOptions: PickerOption[] = scenes.map((s) => ({
    id: s.id,
    label: s.name,
    thumb: s.image || null,
  }));
  const itemOptions: PickerOption[] = items.map((i) => ({
    id: i.id,
    label: i.name,
    thumb: i.image || null,
  }));
  const compositionOptions: PickerOption[] = compositionTasks
    .filter((task) => Boolean(task.image?.url))
    .map((task) => ({
      id: task.id,
      label: `第${task.sceneIndex + 1}场 · ${task.title}`,
      sub: '场景图',
      thumb: task.image?.url ?? null,
    }));

  const toggle = (_ids: string[], setIds: Dispatch<SetStateAction<string[]>>, id: string) => {
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const openPreview = (opt: PickerOption) => {
    if (opt.thumb) setPreviewOption(opt);
  };
  const openOptionDetail = (opt: PickerOption) => {
    if (opt.thumb) {
      openPreview(opt);
      return;
    }
    if (opt.styleEditor) setEditingStyle(opt.styleEditor);
  };
  const handleConfirm = async () => {
    setIsConfirming(true);
    setConfirmError(null);
    try {
      await onConfirm({
        compositionTaskIds,
        characterStyleIds: styleIds,
        sceneIds,
        itemIds,
      });
      onClose();
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : '保存参考资产失败');
    } finally {
      setIsConfirming(false);
    }
  };

  const currentOptions =
    tab === 'composition'
      ? compositionOptions
      : tab === 'characters'
        ? characterOptions
        : tab === 'scenes'
          ? sceneOptions
          : itemOptions;
  const currentSelected =
    tab === 'composition'
      ? compositionTaskIds
      : tab === 'characters'
        ? styleIds
        : tab === 'scenes'
          ? sceneIds
          : itemIds;
  const setCurrentSelected =
    tab === 'composition'
      ? setCompositionTaskIds
      : tab === 'characters'
        ? setStyleIds
        : tab === 'scenes'
          ? setSceneIds
          : setItemIds;

  const tabs: Array<{ key: PickerTab; label: string; count: number }> = [
    { key: 'composition', label: '场景图', count: compositionTaskIds.length },
    { key: 'characters', label: '角色造型', count: styleIds.length },
    { key: 'scenes', label: '场景', count: sceneIds.length },
    { key: 'items', label: '物品', count: itemIds.length },
  ];

  const renderOptionCard = (opt: PickerOption) => {
    const isSelected = currentSelected.includes(opt.id);
    const hasImage = Boolean(opt.thumb);
    const realtimeGenerating = Boolean(opt.styleEditor && isGenerating('style', opt.id));
    const persistedPending = isResourceImagePending(opt.resourceStatus);
    const generating = realtimeGenerating || persistedPending;
    const generationLabel = realtimeGenerating ? '生成中...' : resourceStatusLabel(opt.resourceStatus);
    const generationError =
      opt.styleEditor
        ? getGenerationErrorDisplay(getError('style', opt.id) || opt.resourceError)?.message ?? null
        : null;
    return (
      <div
        key={opt.id}
        className={`overflow-hidden rounded-xl border bg-white text-left transition-colors ${
          isSelected
            ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/15'
            : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'
        }`}
      >
        <button
          type="button"
          onClick={() => (hasImage ? openPreview(opt) : undefined)}
          disabled={!hasImage || isConfirming}
          className={`block w-full text-left ${hasImage ? 'cursor-zoom-in' : 'cursor-default'}`}
          aria-label={hasImage ? `查看${opt.label}` : opt.label}
        >
          <div className="relative flex aspect-video items-center justify-center bg-gray-100">
            {hasImage ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={opt.thumb ?? ''}
                  alt={opt.label}
                  className="h-full w-full object-contain"
                />
                <span className="absolute inset-x-0 bottom-0 bg-black/45 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                  点击放大
                </span>
              </>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
                <ImageIcon className="h-6 w-6 text-gray-400" />
                <div>
                  <div className="text-xs font-medium text-gray-500">
                    {opt.emptyTitle || '暂无图片'}
                  </div>
                  {opt.emptyText && (
                    <div className="mt-1 text-[10px] leading-4 text-gray-400">
                      {opt.emptyText}
                    </div>
                  )}
                </div>
              </div>
            )}
            {generating && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 text-white">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-xs">{generationLabel}</span>
              </div>
            )}
            {opt.badge && (
              <span
                className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] ${
                  hasImage ? 'bg-black/60 text-white' : 'bg-white/85 text-gray-500 shadow-sm'
                }`}
              >
                {opt.badge}
              </span>
            )}
          </div>
        </button>
        <div className="p-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (hasImage && !isSelected) toggle(currentSelected, setCurrentSelected, opt.id);
              }}
              disabled={!hasImage || isConfirming}
              className={`min-w-0 flex-1 text-left ${
                hasImage && !isSelected ? 'hover:text-[var(--color-primary)]' : 'cursor-default'
              } disabled:opacity-100`}
              aria-label={isSelected ? `${opt.label} 已选` : `选择参考：${opt.label}`}
            >
              <div className="truncate text-xs text-[var(--color-text)]">{opt.label}</div>
              {opt.sub && (
                <div className="text-[10px] text-[var(--color-text-secondary)]">{opt.sub}</div>
              )}
            </button>
            {hasImage && (
              <button
                type="button"
                onClick={() => toggle(currentSelected, setCurrentSelected, opt.id)}
                disabled={isConfirming}
                aria-label={isSelected ? `移除引用：${opt.label}` : `选择引用：${opt.label}`}
                title={isSelected ? '移除引用' : '选择引用'}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  isSelected
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                    : 'border-gray-300'
                }`}
              >
                {isSelected && <Check className="h-3 w-3" />}
              </button>
            )}
          </div>
          {!hasImage && opt.styleEditor && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => openOptionDetail(opt)}
                disabled={generating || isConfirming}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs font-medium text-[var(--color-primary)] hover:border-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5" />
                )}
                {generating ? generationLabel : '生成图片'}
              </button>
              {generationError && !generating && (
                <div className="mt-1 line-clamp-2 text-[10px] leading-3 text-red-500">
                  {generationError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[1800] flex items-center justify-center bg-black/40"
        onClick={() => {
          if (!isConfirming) onClose();
        }}
      >
        <div
          className="bg-white rounded-xl p-5 w-[760px] max-w-[94vw] max-h-[80vh] flex flex-col shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold">选择参考资产</h3>
            <button
              onClick={onClose}
              disabled={isConfirming}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-2 mb-3 text-sm">
            {tabs.map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                disabled={isConfirming}
                className={`px-3 py-1.5 rounded-full ${
                  tab === key
                    ? 'bg-[var(--color-dark)] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {label}
                <span className="ml-1.5 text-xs opacity-70">({count})</span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {currentOptions.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-12">
                暂无可选资产，请先在对应模块创建。
              </div>
            ) : tab === 'characters' ? (
              <div className="space-y-5">
                {characterGroups.map((group) => (
                  <section key={group.id}>
                    <div className="mb-2 flex items-center gap-2">
                      <div className="text-sm font-semibold text-[var(--color-text)]">{group.label}</div>
                      <div className="text-xs text-[var(--color-text-secondary)]">
                        {group.options.length} 个造型
                      </div>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                      {group.options.map(renderOptionCard)}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {currentOptions.map(renderOptionCard)}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--color-border)] mt-3">
            {confirmError && (
              <div className="mr-auto self-center text-xs text-red-600">{confirmError}</div>
            )}
            <button
              onClick={onClose}
              disabled={isConfirming}
              className="px-4 py-1.5 rounded-lg border border-[var(--color-border)] text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={() => void handleConfirm()}
              disabled={isConfirming}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {isConfirming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isConfirming ? '保存中…' : '确认'}
            </button>
          </div>
        </div>
      </div>
      {previewOption && previewOption.thumb && (
        <div
          className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/80"
          onClick={(e) => {
            e.stopPropagation();
            if (!isConfirming) setPreviewOption(null);
          }}
        >
          <button
            onClick={() => {
              if (!isConfirming) setPreviewOption(null);
            }}
            disabled={isConfirming}
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors disabled:opacity-40"
            aria-label="关闭预览"
          >
            <X className="w-5 h-5" />
          </button>
          <div
            className="flex max-w-[92vw] max-h-[92vh] flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewOption.thumb}
              alt={previewOption.label}
              className="max-w-[92vw] max-h-[82vh] object-contain"
            />
            <div className="flex max-w-[92vw] items-center gap-3 rounded-full bg-black/55 px-4 py-2 text-white">
              <div className="min-w-0">
                <div className="max-w-[52vw] truncate text-sm font-medium">{previewOption.label}</div>
                {previewOption.sub && (
                  <div className="max-w-[52vw] truncate text-xs text-white/70">
                    {previewOption.sub}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => toggle(currentSelected, setCurrentSelected, previewOption.id)}
                disabled={isConfirming}
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  currentSelected.includes(previewOption.id)
                    ? 'bg-white text-[var(--color-primary)] hover:bg-gray-100'
                    : 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]'
                } disabled:opacity-50`}
              >
                {currentSelected.includes(previewOption.id) ? '已添加' : '添加到参考'}
              </button>
            </div>
          </div>
        </div>
      )}
      {editingStyle && (
        <EntityDetailDrawer
          open
          kind="style"
          entity={styleEditorEntity(editingStyle.style)}
          project={project}
          characterId={editingStyle.character.id}
          identityReferenceAssetId={
            editingStyle.character.identityAssetId ?? editingStyle.character.avatarAssetId ?? null
          }
          buildAutoPrompt={() =>
            buildResourceImagePrompt({
              kind: 'character-style',
              name: editingStyle.character.name,
              description: editingStyle.character.description,
              bio: editingStyle.character.bio,
              styleName: editingStyle.style.name,
              userPrompt: editingStyle.style.prompt,
              projectStylePrompt: project.stylePrompt,
              ratio: editingStyle.style.ratio || project.ratio,
            })
          }
          onSave={async (patch) => {
            const fresh = await updateCharacterStyle(editingStyle.style.id, patch);
            await onRefreshReferences();
            return styleEditorEntity({ ...fresh, id: fresh.id ?? editingStyle.style.id });
          }}
          onClose={() => setEditingStyle(null)}
        />
      )}
    </>
  );
}

function styleEditorEntity(style: CharacterStyle & { id: string }): EntityDetailData {
  return {
    id: style.id,
    name: style.name,
    prompt: style.prompt ?? '',
    model: style.model ?? null,
    ratio: style.ratio ?? null,
    image: style.image || style.styleResourceImage?.image || '',
    assetId: style.assetId ?? style.styleResourceImage?.assetId ?? null,
  };
}
