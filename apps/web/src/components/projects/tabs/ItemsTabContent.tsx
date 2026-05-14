'use client';

import { useEffect, useRef, useState } from 'react';
import { Item, Project } from '@/types';
import { Plus, Trash2, ImagePlus, Loader2, Sparkles, Upload, X } from 'lucide-react';
import {
  createItem,
  deleteItem,
  updateItem,
  uploadAsset,
  createImageTask,
  pollTaskUntilDone,
  getProjectItems,
} from '@/lib/api';

interface Props {
  items: Item[];
  project: Project;
  onChange: (next: Item[]) => void;
}

/**
 * Reference: docs/research/likeai-screenshots/p04-tab-items.png
 *
 * Layout: grid of cards. First card is "+ 添加物品" placeholder.
 * Each item card: square image area + name label at bottom.
 * Hover over a card reveals delete + regenerate controls.
 *
 * Click "添加物品" opens small modal with name input + 取消/确认 buttons.
 */
export function ItemsTabContent({ items, project, onChange }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const fresh = await getProjectItems(project.id);
    onChange(fresh);
  };

  const handleCreate = async (data: { name: string; assetId?: string | null }) => {
    setError(null);
    try {
      await createItem(project.id, data);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
      throw e;
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该物品？')) return;
    setBusy(`del-${id}`);
    try {
      await deleteItem(id);
      onChange(items.filter((i) => i.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
        {/* "+ 添加物品" placeholder card (first slot, like LikeAI) */}
        <button
          onClick={() => setShowAdd(true)}
          className="aspect-square rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors bg-[var(--color-bg-card)]"
        >
          <Plus className="w-8 h-8" />
          <span className="text-sm">添加物品</span>
        </button>

        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            project={project}
            busy={busy === `del-${item.id}`}
            onDelete={() => handleDelete(item.id)}
            onUpdated={async () => reload()}
          />
        ))}
      </div>

      {error && <div className="text-sm text-red-600 mt-4">{error}</div>}

      <AddItemModal
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}

function ItemCard({
  item,
  project,
  busy,
  onDelete,
  onUpdated,
}: {
  item: Item;
  project: Project;
  busy: boolean;
  onDelete: () => void;
  onUpdated: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regenerate = async () => {
    setGenBusy(true);
    setError(null);
    try {
      const prompt = [
        `物品：${item.name}`,
        '输出：单个物品特写，纯色背景，光线柔和',
        project.stylePrompt ? `风格：${project.stylePrompt}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const task = await createImageTask(
        project.id,
        { prompt, ratio: '1:1', model: project.imageModel, n: 1 },
        'openai',
      );
      const final = await pollTaskUntilDone(task.id);
      if (final.status !== 'SUCCEEDED' || !final.outputAssets?.[0]) {
        throw new Error(final.error || '生成失败');
      }
      await updateItem(item.id, { assetId: final.outputAssets[0].id });
      await onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setGenBusy(false);
    }
  };

  const upload = async (file: File) => {
    setUploadBusy(true);
    setError(null);
    try {
      const a = await uploadAsset(file);
      await updateItem(item.id, { assetId: a.id });
      await onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploadBusy(false);
    }
  };

  return (
    <div className="group relative rounded-xl overflow-hidden bg-[var(--color-bg-card)] border border-[var(--color-border)]">
      <div className="aspect-square flex items-center justify-center relative">
        {item.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center text-gray-400 cursor-pointer" onClick={regenerate}>
            <Sparkles className="w-8 h-8" />
            <span className="text-xs mt-1">点击生成</span>
          </div>
        )}
        {(genBusy || uploadBusy) && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
        )}
      </div>
      <div className="px-3 py-2 bg-gray-700 text-white text-xs text-center truncate">
        {item.name}
      </div>

      <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={regenerate}
          disabled={genBusy || uploadBusy}
          className="w-7 h-7 rounded-md bg-white/90 text-gray-700 hover:text-[var(--color-primary)] flex items-center justify-center"
          aria-label="重新生成"
          title="AI 重新生成"
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={genBusy || uploadBusy}
          className="w-7 h-7 rounded-md bg-white/90 text-gray-700 hover:text-[var(--color-primary)] flex items-center justify-center"
          aria-label="上传图片"
          title="上传本地图片"
        >
          <Upload className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          disabled={busy}
          className="w-7 h-7 rounded-md bg-white/90 text-gray-600 hover:text-red-500 flex items-center justify-center"
          aria-label="删除"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = '';
        }}
      />

      {error && <div className="text-xs text-red-600 px-3 py-1 bg-red-50">{error}</div>}
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
