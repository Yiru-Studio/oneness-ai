'use client';

import { useEffect, useRef, useState } from 'react';
import { Scene, Project } from '@/types';
import { Plus, Trash2, ImagePlus, Loader2, Sparkles, Upload, X, FileText } from 'lucide-react';
import {
  createScene,
  deleteScene,
  updateScene,
  uploadAsset,
  createImageTask,
  pollTaskUntilDone,
  getProjectScenes,
} from '@/lib/api';

interface Props {
  scenes: Scene[];
  project: Project;
  scriptContent?: string;
  onChange: (next: Scene[]) => void;
}

/**
 * Reference: docs/research/likeai-screenshots/p05-tab-scenes-loaded.png
 *
 * Same layout as Items: grid of cards with first slot = "+ 添加场景".
 * Card hover reveals delete + AI regenerate (script-aware) + upload controls.
 *
 * "添加场景" opens dialog with 场景标题 input.
 */
export function ScenesTabContent({ scenes, project, scriptContent, onChange }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const fresh = await getProjectScenes(project.id);
    onChange(fresh);
  };

  const handleCreate = async (data: { name: string; assetId?: string | null }) => {
    setError(null);
    try {
      await createScene(project.id, data);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
      throw e;
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该场景？')) return;
    setBusy(`del-${id}`);
    try {
      await deleteScene(id);
      onChange(scenes.filter((s) => s.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(null);
    }
  };

  const aspect = project.ratio === '16:9' ? 'aspect-video' : project.ratio === '9:16' ? 'aspect-[9/16]' : 'aspect-[4/3]';

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className={`grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4`}>
        <button
          onClick={() => setShowAdd(true)}
          className={`${aspect} rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors bg-[var(--color-bg-card)]`}
        >
          <Plus className="w-8 h-8" />
          <span className="text-sm">添加场景</span>
        </button>

        {scenes.map((scene) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            project={project}
            scriptContent={scriptContent}
            aspect={aspect}
            busy={busy === `del-${scene.id}`}
            onDelete={() => handleDelete(scene.id)}
            onUpdated={async () => reload()}
          />
        ))}
      </div>

      {error && <div className="text-sm text-red-600 mt-4">{error}</div>}

      <AddSceneModal
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}

function SceneCard({
  scene,
  project,
  scriptContent,
  aspect,
  busy,
  onDelete,
  onUpdated,
}: {
  scene: Scene;
  project: Project;
  scriptContent?: string;
  aspect: string;
  busy: boolean;
  onDelete: () => void;
  onUpdated: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildScenePrompt = (): string => {
    // "Auto-fill prompt from script" rule: pull lines that mention this scene name,
    // fall back to opening of script if no matches. Compose with style guidance.
    const ctxLines = scriptContent
      ? scriptContent
          .split(/\n+/)
          .filter((l) => l.trim().length > 0)
          .filter((l) => l.includes(scene.name) || l.includes(scene.name.split(/[\s\-_/]/)[0] ?? ''))
          .slice(0, 6)
          .join('\n')
      : '';
    return [
      `场景：${scene.name}`,
      ctxLines ? `剧本节选：\n${ctxLines}` : '',
      '输出：俯视全景，光线明确，环境细节丰富',
      project.stylePrompt ? `风格：${project.stylePrompt}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  };

  const regenerate = async () => {
    setGenBusy(true);
    setError(null);
    try {
      const task = await createImageTask(
        project.id,
        { prompt: buildScenePrompt(), ratio: project.ratio, model: project.imageModel, n: 1 },
        'openai',
      );
      const final = await pollTaskUntilDone(task.id);
      if (final.status !== 'SUCCEEDED' || !final.outputAssets?.[0]) {
        throw new Error(final.error || '生成失败');
      }
      await updateScene(scene.id, { assetId: final.outputAssets[0].id });
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
      await updateScene(scene.id, { assetId: a.id });
      await onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploadBusy(false);
    }
  };

  return (
    <div className="group relative rounded-xl overflow-hidden bg-[var(--color-bg-card)] border border-[var(--color-border)]">
      <div className={`${aspect} flex items-center justify-center relative`}>
        {scene.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={scene.image} alt={scene.name} className="w-full h-full object-cover" />
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
      <div className="px-3 py-2 bg-gray-700 text-white text-xs text-center truncate" title={scene.name}>
        {scene.name}
      </div>

      <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={regenerate}
          disabled={genBusy || uploadBusy}
          title="基于剧本上下文 AI 重新生成"
          className="w-7 h-7 rounded-md bg-white/90 text-gray-700 hover:text-[var(--color-primary)] flex items-center justify-center"
          aria-label="重新生成"
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={genBusy || uploadBusy}
          title="上传本地图片"
          className="w-7 h-7 rounded-md bg-white/90 text-gray-700 hover:text-[var(--color-primary)] flex items-center justify-center"
          aria-label="上传图片"
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
