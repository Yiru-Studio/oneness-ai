'use client';

import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { Scene, Project } from '@/types';
import { Plus, Trash2, Loader2, ImagePlus, X } from 'lucide-react';
import {
  createScene,
  deleteScene,
  updateScene,
  getProjectScenes,
} from '@/lib/api';
import { EntityDetailDrawer } from '@/components/projects/EntityDetailDrawer';
import { useGeneration } from '@/contexts/GenerationContext';
import { buildResourceImagePrompt } from '@oneness/shared/resource-prompts';

interface Props {
  scenes: Scene[];
  project: Project;
  scriptContent?: string;
  onChange: Dispatch<SetStateAction<Scene[]>>;
}

/**
 * Scenes tab — grid of cards. Clicking a card opens the secondary detail
 * drawer with prompt + model + ratio editor.
 */
export function ScenesTabContent({ scenes, project, scriptContent, onChange }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { isGenerating } = useGeneration();

  const aspect =
    project.ratio === '16:9'
      ? 'aspect-video'
      : project.ratio === '9:16'
        ? 'aspect-[9/16]'
        : 'aspect-[4/3]';

  const reload = async () => {
    const fresh = await getProjectScenes(project.id);
    onChange(fresh);
    return fresh;
  };

  const handleCreate = async (data: { name: string }) => {
    setError(null);
    try {
      const created = await createScene(project.id, data);
      const fresh = await reload();
      setOpenId(created.id ?? fresh[fresh.length - 1]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
      throw e;
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该场景？')) return;
    setBusy(`del-${id}`);
    try {
      await deleteScene(id);
      onChange((prev) => prev.filter((s) => s.id !== id));
      if (openId === id) setOpenId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(null);
    }
  };

  const opened = openId ? scenes.find((s) => s.id === openId) ?? null : null;

  const buildAutoPrompt = (scene: Scene): string => {
    const stem = scene.name.replace(/^(INT|EXT)\.?\s*/i, '').split(/\s*[-–]\s*/)[0];
    const ctxLines = scriptContent
      ? scriptContent
          .split(/\n+/)
          .filter((l) => l.trim().length > 0)
          .filter((l) => l.includes(scene.name) || (stem && l.includes(stem)))
          .slice(0, 8)
          .join('\n')
      : '';
    return buildResourceImagePrompt({
      kind: 'scene',
      name: scene.name,
      description: scene.description,
      userPrompt: ctxLines ? `剧本节选：\n${ctxLines}` : '',
      projectStylePrompt: project.stylePrompt,
      ratio: project.ratio,
    });
  };

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        <button
          onClick={() => setShowAdd(true)}
          className={`${aspect} rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors bg-[var(--color-bg-card)]`}
        >
          <Plus className="w-8 h-8" />
          <span className="text-sm">添加场景</span>
        </button>

        {scenes.map((scene) => (
          <div
            key={scene.id}
            className="group relative rounded-xl overflow-hidden bg-[var(--color-bg-card)] border border-[var(--color-border)] cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setOpenId(scene.id)}
          >
            <div className={`${aspect} flex items-center justify-center relative`}>
              {scene.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={scene.image} alt={scene.name} className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center text-gray-400">
                  <ImagePlus className="w-8 h-8" />
                  <span className="text-xs mt-1">点击编辑</span>
                </div>
              )}
              {isGenerating('scene', scene.id) && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                </div>
              )}
            </div>
            <div className="px-3 py-2 bg-gray-700 text-white text-xs text-center truncate" title={scene.name}>
              {scene.name}
            </div>

            <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete(scene.id);
                }}
                disabled={busy === `del-${scene.id}`}
                className="w-7 h-7 rounded-md bg-white/95 text-gray-600 hover:text-red-500 flex items-center justify-center shadow-sm"
                title="删除"
              >
                {busy === `del-${scene.id}` ? (
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

      <AddSceneModal isOpen={showAdd} onClose={() => setShowAdd(false)} onCreate={handleCreate} />

      {opened && (
        <EntityDetailDrawer
          open
          kind="scene"
          entity={opened}
          project={project}
          buildAutoPrompt={() => buildAutoPrompt(opened)}
          onSave={async (patch) => {
            const fresh = await updateScene(opened.id, patch);
            onChange((prev) => prev.map((s) => (s.id === fresh.id ? fresh : s)));
            return fresh;
          }}
          onDelete={async () => {
            await deleteScene(opened.id);
            onChange((prev) => prev.filter((s) => s.id !== opened.id));
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function AddSceneModal({
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
      setError('请输入场景标题');
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
          <h3 className="text-base font-semibold">添加场景</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">场景标题</label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleConfirm();
              }}
              placeholder="如：INT. 老旧家属楼 - 午后"
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
