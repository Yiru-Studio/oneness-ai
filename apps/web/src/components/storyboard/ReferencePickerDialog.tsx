'use client';

import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { X, Check } from 'lucide-react';
import { Character, CompositionTask, Item, Scene } from '@/types';

type PickerTab = 'composition' | 'characters' | 'scenes' | 'items';

type PickerOption = {
  id: string;
  label: string;
  sub?: string;
  thumb: string | null;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  characters: Character[];
  items: Item[];
  scenes: Scene[];
  compositionTasks: CompositionTask[];
  selected: {
    compositionTaskIds: string[];
    characterStyleIds: string[];
    sceneIds: string[];
    itemIds: string[];
  };
  onConfirm: (next: {
    compositionTaskIds: string[];
    characterStyleIds: string[];
    sceneIds: string[];
    itemIds: string[];
  }) => void;
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
  selected,
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

  useEffect(() => {
    if (!isOpen) return;
    setCompositionTaskIds(selected.compositionTaskIds);
    setStyleIds(selected.characterStyleIds);
    setSceneIds(selected.sceneIds);
    setItemIds(selected.itemIds);
    setPreviewOption(null);
    setTab('composition');
  }, [
    isOpen,
    selected.compositionTaskIds,
    selected.characterStyleIds,
    selected.sceneIds,
    selected.itemIds,
  ]);

  if (!isOpen) return null;

  const characterOptions: PickerOption[] = characters.flatMap((c) =>
    c.styles
      .filter((s) => Boolean(s.id))
      .map((s) => ({
        id: s.id as string,
        label: c.name,
        sub: s.name,
        thumb: s.image || c.avatar || null,
      })),
  );
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
      sub: '合成镜头图',
      thumb: task.image?.url ?? null,
    }));

  const toggle = (_ids: string[], setIds: Dispatch<SetStateAction<string[]>>, id: string) => {
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const openPreview = (opt: PickerOption) => {
    if (opt.thumb) setPreviewOption(opt);
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
    { key: 'composition', label: '合成镜头', count: compositionTaskIds.length },
    { key: 'characters', label: '角色造型', count: styleIds.length },
    { key: 'scenes', label: '场景', count: sceneIds.length },
    { key: 'items', label: '物品', count: itemIds.length },
  ];

  return (
    <>
      <div
        className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-xl p-5 w-[760px] max-w-[94vw] max-h-[80vh] flex flex-col shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold">选择参考资产</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-2 mb-3 text-sm">
            {tabs.map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 rounded-full ${
                  tab === key
                    ? 'bg-[var(--color-dark)] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
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
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {currentOptions.map((opt) => {
                  const isSelected = currentSelected.includes(opt.id);
                  return (
                    <div
                      key={opt.id}
                      className={`relative rounded-lg overflow-hidden border-2 text-left transition bg-white ${
                        isSelected
                          ? 'border-[var(--color-primary)] shadow'
                          : 'border-[var(--color-border)] hover:border-gray-400'
                      }`}
                    >
                      <button
                        type="button"
                        onPointerDown={() => openPreview(opt)}
                        onClick={() => openPreview(opt)}
                        disabled={!opt.thumb}
                        className="aspect-square w-full bg-gray-100 flex items-center justify-center relative disabled:cursor-default enabled:cursor-zoom-in group"
                        aria-label={opt.thumb ? `查看${opt.label}` : opt.label}
                      >
                        {opt.thumb ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={opt.thumb}
                              alt={opt.label}
                              className="w-full h-full object-cover"
                            />
                            <span className="absolute inset-x-0 bottom-0 px-2 py-1 text-[10px] text-white bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity">
                              点击放大
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">无封面</span>
                        )}
                      </button>
                      <div className="px-2 py-1.5">
                        <div className="text-xs font-medium truncate">{opt.label}</div>
                        {opt.sub && (
                          <div className="text-[10px] text-gray-500 truncate">{opt.sub}</div>
                        )}
                        <button
                          type="button"
                          onClick={() => toggle(currentSelected, setCurrentSelected, opt.id)}
                          className={`mt-1.5 flex h-7 w-full items-center justify-center gap-1 rounded-md text-xs font-medium transition ${
                            isSelected
                              ? 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3" />}
                          {isSelected ? '已添加' : '添加'}
                        </button>
                      </div>
                      {isSelected && (
                        <div className="absolute top-1 right-1 bg-[var(--color-primary)] text-white rounded-full w-5 h-5 flex items-center justify-center">
                          <Check className="w-3 h-3" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--color-border)] mt-3">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-[var(--color-border)] text-sm hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={() => {
                onConfirm({
                  compositionTaskIds,
                  characterStyleIds: styleIds,
                  sceneIds,
                  itemIds,
                });
                onClose();
              }}
              className="px-4 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)]"
            >
              确认
            </button>
          </div>
        </div>
      </div>
      {previewOption && previewOption.thumb && (
        <div
          className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/80"
          onClick={(e) => {
            e.stopPropagation();
            setPreviewOption(null);
          }}
        >
          <button
            onClick={() => setPreviewOption(null)}
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
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
                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  currentSelected.includes(previewOption.id)
                    ? 'bg-white text-[var(--color-primary)] hover:bg-gray-100'
                    : 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]'
                }`}
              >
                {currentSelected.includes(previewOption.id) ? '已添加' : '添加到参考'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
