'use client';

import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { Item, Project } from '@/types';
import { Plus, Trash2, Loader2, ImagePlus, X } from 'lucide-react';
import {
  createItem,
  deleteItem,
  updateItem,
  getProjectItems,
} from '@/lib/api';
import { buildResourceImagePrompt } from '@oneness/shared/resource-prompts';
import { EntityDetailDrawer } from '@/components/projects/EntityDetailDrawer';
import { useGeneration } from '@/contexts/GenerationContext';

interface Props {
  items: Item[];
  project: Project;
  scriptContent?: string;
  onChange: Dispatch<SetStateAction<Item[]>>;
}

/**
 * Items tab — grid of cards. Clicking a card opens the secondary detail
 * drawer (matches likeai.pro). Inline hover controls reduced to delete only.
 *
 * Reference:
 *  - docs/research/likeai-screenshots/p04-tab-items.png
 *  - docs/research/likeai-screenshots/p04-item-detail.png
 */
export function ItemsTabContent({ items, project, scriptContent, onChange }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { isGenerating } = useGeneration();

  const reload = async () => {
    const fresh = await getProjectItems(project.id);
    onChange(fresh);
    return fresh;
  };

  const handleCreate = async (data: { name: string }) => {
    setError(null);
    try {
      const created = await createItem(project.id, data);
      const fresh = await reload();
      // Open the detail drawer on the newly created entity
      setOpenId(created.id ?? fresh[fresh.length - 1]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
      throw e;
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该物品？')) return;
    setBusy(`del-${id}`);
    try {
      await deleteItem(id);
      onChange((prev) => prev.filter((i) => i.id !== id));
      if (openId === id) setOpenId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(null);
    }
  };

  const opened = openId ? items.find((i) => i.id === openId) ?? null : null;

  const buildAutoPrompt = (item: Item): string => {
    const ctxLines = scriptContent
      ? scriptContent
          .split(/\n+/)
          .filter((l) => l.trim().length > 0)
          .filter((l) => l.includes(item.name))
          .slice(0, 6)
          .join('\n')
      : '';
    return buildResourceImagePrompt({
      kind: 'item',
      name: item.name,
      description: item.description,
      userPrompt: ctxLines ? `剧本节选：\n${ctxLines}` : '',
      projectStylePrompt: project.stylePrompt,
      ratio: project.ratio,
    });
  };

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        <button
          onClick={() => setShowAdd(true)}
          className="aspect-square rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors bg-[var(--color-bg-card)]"
        >
          <Plus className="w-8 h-8" />
          <span className="text-sm">添加物品</span>
        </button>

        {items.map((item) => (
          <div
            key={item.id}
            className="group relative rounded-xl overflow-hidden bg-[var(--color-bg-card)] border border-[var(--color-border)] cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setOpenId(item.id)}
          >
            <div className="aspect-square flex items-center justify-center relative">
              {item.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center text-gray-400">
                  <ImagePlus className="w-8 h-8" />
                  <span className="text-xs mt-1">点击编辑</span>
                </div>
              )}
              {isGenerating('item', item.id) && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                </div>
              )}
            </div>
            <div className="px-3 py-2 bg-gray-700 text-white text-xs text-center truncate" title={item.name}>
              {item.name}
            </div>

            <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete(item.id);
                }}
                disabled={busy === `del-${item.id}`}
                className="w-7 h-7 rounded-md bg-white/95 text-gray-600 hover:text-red-500 flex items-center justify-center shadow-sm"
                title="删除"
              >
                {busy === `del-${item.id}` ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        ))}
      </div>

      {error && <div className="text-sm text-red-600 mt-4">{error}</div>}

      <AddItemModal isOpen={showAdd} onClose={() => setShowAdd(false)} onCreate={handleCreate} />

      {opened && (
        <EntityDetailDrawer
          open
          kind="item"
          entity={opened}
          project={project}
          buildAutoPrompt={() => buildAutoPrompt(opened)}
          onSave={async (patch) => {
            const fresh = await updateItem(opened.id, patch);
            onChange((prev) => prev.map((i) => (i.id === fresh.id ? fresh : i)));
            return fresh;
          }}
          onDelete={async () => {
            await deleteItem(opened.id);
            onChange((prev) => prev.filter((i) => i.id !== opened.id));
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function AddItemModal({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: { name: string }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setName('');
      setBusy(false);
      setError(null);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    if (!name.trim()) {
      setError('请输入物品名称');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name: name.trim() });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl p-6 w-[420px] relative shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">添加物品</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">物品名称</label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleConfirm();
              }}
              placeholder="请输入物品名称"
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors text-sm"
            />
            <div className="text-xs text-gray-400 mt-1">
              创建后可在右侧详情面板编辑提示词、模型、比例并生成图片
            </div>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg border border-[var(--color-border)] text-sm hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={busy || !name.trim()}
              className="px-4 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {busy ? '创建中…' : '确认'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
