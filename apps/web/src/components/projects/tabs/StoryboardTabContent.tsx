'use client';

import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StoryboardEpisode, Project } from '@/types';
import { Plus, CheckCircle2, Trash2, Loader2, Sparkles, X, Pencil, FileText, Film } from 'lucide-react';
import {
  createEpisode,
  deleteEpisode,
  updateEpisode,
  analyzeEpisode,
  analyzeEpisodeForStoryboard,
  getProjectStoryboard,
  pollTaskUntilDone,
  type TaskDTO,
} from '@/lib/api';

interface Props {
  episodes: StoryboardEpisode[];
  project: Project;
  onChange: Dispatch<SetStateAction<StoryboardEpisode[]>>;
}

/**
 * Reference: docs/research/likeai-screenshots/p07-tab-storyboard.png + image17.png/image18.png
 * Layout: card grid with episodes; "+ 添加剧集" placeholder; clicking a card opens
 * an inline editor showing title, number, content, and re-analyze controls.
 */
export function StoryboardTabContent({ episodes, project, onChange }: Props) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [analyzeId, setAnalyzeId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const fresh = await getProjectStoryboard(project.id);
    onChange(fresh);
  };

  const handleCreate = async (data: { number: number; title: string; content: string }) => {
    setError(null);
    try {
      await createEpisode(project.id, data);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
      throw e;
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该剧集？此操作不可撤销。')) return;
    setBusy(`del-${id}`);
    try {
      await deleteEpisode(id);
      onChange((prev) => prev.filter((e) => e.id !== id));
      if (openId === id) setOpenId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(null);
    }
  };

  const handleAnalyze = async (id: string) => {
    setBusy(`an-${id}`);
    setError(null);
    try {
      await analyzeEpisode(project.id, id);
      // Worker will eventually populate. We don't poll here; the parent page polls.
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析任务启动失败');
    } finally {
      setBusy(null);
    }
  };

  const open = openId ? episodes.find((e) => e.id === openId) ?? null : null;

  const nextNumber = (episodes.reduce((m, e) => Math.max(m, e.number), 0) || 0) + 1;

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {episodes.map((ep) => (
          <div
            key={ep.id}
            className="group relative rounded-xl border border-[var(--color-border)] bg-white p-4 hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => {
              if (ep.analyzed) {
                router.push(`/projects/${project.id}/episodes/${ep.id}`);
              } else {
                setAnalyzeId(ep.id);
              }
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold">[{ep.number}]</span>
              {ep.analyzed ? (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
                  <CheckCircle2 className="w-3 h-3" />
                  已分析
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                  <FileText className="w-3 h-3" />
                  未分析
                </span>
              )}
            </div>
            <div className="font-medium mb-2 truncate" title={ep.title}>
              {ep.title}
            </div>
            <div className="text-xs text-[var(--color-text-secondary)] line-clamp-4 leading-relaxed whitespace-pre-wrap">
              {ep.content}
            </div>

            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {ep.analyzed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/projects/${project.id}/episodes/${ep.id}`);
                  }}
                  title="进入分镜创作"
                  className="w-7 h-7 rounded-md bg-white/95 border border-[var(--color-border)] text-gray-700 hover:text-[var(--color-primary)] flex items-center justify-center"
                >
                  <Film className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenId(ep.id);
                }}
                title="查看 / 编辑剧本"
                className="w-7 h-7 rounded-md bg-white/95 border border-[var(--color-border)] text-gray-700 hover:text-[var(--color-primary)] flex items-center justify-center"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleAnalyze(ep.id);
                }}
                disabled={busy === `an-${ep.id}`}
                title="重新分析（拆分角色 / 物品 / 场景）"
                className="w-7 h-7 rounded-md bg-white/95 border border-[var(--color-border)] text-gray-700 hover:text-[var(--color-primary)] flex items-center justify-center"
              >
                {busy === `an-${ep.id}` ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete(ep.id);
                }}
                disabled={busy === `del-${ep.id}`}
                title="删除剧集"
                className="w-7 h-7 rounded-md bg-white/95 border border-[var(--color-border)] text-gray-600 hover:text-red-500 flex items-center justify-center"
              >
                {busy === `del-${ep.id}` ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        ))}

        {/* Add episode card */}
        <button
          onClick={() => setShowAdd(true)}
          className="aspect-[4/3] rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-2 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors bg-[var(--color-bg-card)] text-gray-500"
        >
          <Plus className="w-8 h-8" />
          <span className="text-sm">添加剧集</span>
        </button>
      </div>

      {error && <div className="text-sm text-red-600 mt-4">{error}</div>}

      <AddEpisodeModal
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        defaultNumber={nextNumber}
        onCreate={handleCreate}
      />

      {open && (
        <EpisodeDetailDrawer
          episode={open}
          onClose={() => setOpenId(null)}
          onSaved={async () => reload()}
          onAnalyze={() => handleAnalyze(open.id)}
          analyzing={busy === `an-${open.id}`}
        />
      )}

      <AnalyzeEpisodeDialog
        episode={analyzeId ? episodes.find((e) => e.id === analyzeId) ?? null : null}
        onClose={() => setAnalyzeId(null)}
        onAnalyzed={async () => {
          const id = analyzeId!;
          const fresh = await getProjectStoryboard(project.id);
          onChange(fresh);
          setAnalyzeId(null);
          router.push(`/projects/${project.id}/episodes/${id}`);
        }}
        onAnalyzeRequest={() => analyzeEpisodeForStoryboard(project.id, analyzeId!)}
      />
    </div>
  );
}

function AnalyzeEpisodeDialog({
  episode,
  onClose,
  onAnalyzed,
  onAnalyzeRequest,
}: {
  episode: StoryboardEpisode | null;
  onClose: () => void;
  onAnalyzed: () => void | Promise<void>;
  onAnalyzeRequest: () => Promise<TaskDTO>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!episode) {
      setBusy(false);
      setError(null);
    }
  }, [episode]);

  if (!episode) return null;

  const handleAnalyze = async () => {
    setBusy(true);
    setError(null);
    try {
      const task = await onAnalyzeRequest();
      const done = await pollTaskUntilDone(task.id, { intervalMs: 2000, timeoutMs: 4 * 60_000 });
      if (done.status !== 'SUCCEEDED') {
        throw new Error(done.error || '分析失败');
      }
      await onAnalyzed();
    } catch (e) {
      setError(e instanceof Error ? e.message : '分析失败');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl w-[640px] max-w-[92vw] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
          <h3 className="text-base font-semibold">分析剧集</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="text-xs text-[var(--color-text-secondary)] mb-1">
            【{episode.number}】{episode.title}
          </div>
          <div className="text-xs text-[var(--color-text-secondary)] mb-1.5">剧本内容</div>
          <div className="rounded-lg bg-gray-50 border border-[var(--color-border)] px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap font-mono max-h-[40vh] overflow-y-auto">
            {episode.content || <span className="text-gray-400">（剧集尚未填入剧本）</span>}
          </div>
          {busy && (
            <div className="text-xs text-[var(--color-text-secondary)] mt-3 inline-flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              正在调用大模型拆解场景（约需 1 分钟），请勿关闭…
            </div>
          )}
          {error && <div className="text-sm text-red-600 mt-3">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--color-border)]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-[var(--color-border)] text-sm hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleAnalyze}
            disabled={busy}
            className="px-4 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                分析中…
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                分析剧集
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddEpisodeModal({
  isOpen,
  onClose,
  defaultNumber,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  defaultNumber: number;
  onCreate: (data: { number: number; title: string; content: string }) => Promise<void>;
}) {
  const [number, setNumber] = useState(defaultNumber);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setNumber(defaultNumber);
      setTitle('');
      setContent('');
      setBusy(false);
      setError(null);
    } else {
      setNumber(defaultNumber);
    }
  }, [isOpen, defaultNumber]);

  const handleConfirm = async () => {
    if (!title.trim() || !content.trim()) {
      setError('请填写标题和剧本内容');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate({ number, title: title.trim(), content: content.trim() });
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
        className="bg-white rounded-xl p-6 w-[640px] max-w-[92vw] relative shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">添加剧集</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="w-24">
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">集数</label>
              <input
                type="number"
                min={1}
                value={number}
                onChange={(e) => setNumber(Number(e.target.value) || 1)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-[var(--color-text-secondary)] mb-1">剧集标题</label>
              <input
                autoFocus
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="如：第1集 - 最后一封信"
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">剧本内容</label>
            <textarea
              rows={10}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="粘贴剧本文本，支持中文 / 英文。保存后可点击「分析」自动拆分角色 / 物品 / 场景。"
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none transition-colors text-sm resize-none font-mono"
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
              disabled={busy || !title.trim() || !content.trim()}
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

function EpisodeDetailDrawer({
  episode,
  onClose,
  onSaved,
  onAnalyze,
  analyzing,
}: {
  episode: StoryboardEpisode;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onAnalyze: () => void;
  analyzing: boolean;
}) {
  const [editTitle, setEditTitle] = useState(false);
  const [editContent, setEditContent] = useState(false);
  const [title, setTitle] = useState(episode.title);
  const [content, setContent] = useState(episode.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(episode.title);
    setContent(episode.content);
  }, [episode.id, episode.title, episode.content]);

  const saveTitle = async () => {
    if (title === episode.title) {
      setEditTitle(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateEpisode(episode.id, { title: title.trim() });
      await onSaved();
      setEditTitle(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveContent = async () => {
    if (content === episode.content) {
      setEditContent(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateEpisode(episode.id, { content });
      await onSaved();
      setEditContent(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1900] flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-[720px] max-w-[100vw] h-full bg-white shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-white border-b border-[var(--color-border)] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-sm font-bold text-[var(--color-text-secondary)]">[{episode.number}]</span>
            {editTitle ? (
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveTitle();
                  if (e.key === 'Escape') {
                    setTitle(episode.title);
                    setEditTitle(false);
                  }
                }}
                className="flex-1 px-2 py-1 rounded-lg border border-[var(--color-border)] outline-none text-base font-semibold focus:border-[var(--color-primary)]"
              />
            ) : (
              <button
                onClick={() => setEditTitle(true)}
                className="flex items-center gap-1.5 group text-base font-semibold truncate"
                title="点击编辑标题"
              >
                <span className="truncate">{episode.title}</span>
                <Pencil className="w-3.5 h-3.5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              </button>
            )}
            {episode.analyzed && (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)] flex-shrink-0">
                <CheckCircle2 className="w-3 h-3" />
                已分析
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onAnalyze}
              disabled={analyzing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {analyzing ? '分析启动中…' : '重新分析'}
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">剧本内容</label>
            {!editContent && (
              <button
                onClick={() => setEditContent(true)}
                className="text-xs text-[var(--color-primary)] hover:underline inline-flex items-center gap-1"
              >
                <Pencil className="w-3 h-3" />
                编辑
              </button>
            )}
          </div>
          {editContent ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                rows={20}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none text-sm resize-y font-mono leading-relaxed"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setContent(episode.content);
                    setEditContent(false);
                  }}
                  className="px-3 py-1 rounded-lg border border-[var(--color-border)] text-sm hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={saveContent}
                  disabled={saving}
                  className="px-3 py-1 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-gray-50 border border-[var(--color-border)] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap font-mono max-h-[60vh] overflow-y-auto">
              {episode.content}
            </div>
          )}

          {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
        </div>
      </div>
    </div>
  );
}
