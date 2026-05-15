'use client';

import { useEffect, useRef, useState } from 'react';
import { Character, Project } from '@/types';
import { User, ImagePlus, Plus, Trash2, Sparkles, Upload, Loader2, Pencil } from 'lucide-react';
import {
  createCharacter,
  updateCharacter,
  deleteCharacter,
  createCharacterStyle,
  updateCharacterStyle,
  deleteCharacterStyle,
  uploadAsset,
  createImageTask,
  pollTaskUntilDone,
  getProjectCharacters,
  analyzeCharacter,
} from '@/lib/api';
import { AddCharacterModal } from '@/components/modals/AddCharacterModal';
import { EntityDetailDrawer } from '@/components/projects/EntityDetailDrawer';
import { imageProviderForModel } from '@/data/style-presets';

interface Props {
  characters: Character[];
  project: Project;
  scriptContent?: string;
  onChange: (next: Character[]) => void;
}

/**
 * Reference screenshots:
 *  - docs/research/likeai-screenshots/p03-tab-characters.png  (analyzed character)
 *  - docs/research/likeai-screenshots/p03-blank-char-detail.png  (fresh blank character: 分析/创建为空白)
 *  - docs/research/likeai-screenshots/p03-blank-completed.png  (after 创建为空白角色: editable form)
 */
export function CharactersTabContent({ characters, project, onChange }: Props) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const effectiveId = pickedId ?? characters[0]?.id ?? null;
  const selected = characters.find((c) => c.id === effectiveId) ?? null;

  const [showAdd, setShowAdd] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = async () => {
    const fresh = await getProjectCharacters(project.id);
    onChange(fresh);
  };

  const handleCreate = async (data: { name: string; description?: string }) => {
    setActionError(null);
    try {
      const created = await createCharacter(project.id, data);
      await reload();
      setPickedId(created.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '创建失败');
      throw e;
    }
  };

  const handleDelete = async (charId: string) => {
    if (!confirm('确认删除该角色？此操作不可撤销。')) return;
    setActionBusy(`del-${charId}`);
    setActionError(null);
    try {
      await deleteCharacter(charId);
      const fresh = characters.filter((c) => c.id !== charId);
      onChange(fresh);
      if (effectiveId === charId) setPickedId(fresh[0]?.id ?? null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div className="flex h-full">
      {/* Left list */}
      <div className="w-[280px] flex-shrink-0 border-r border-[var(--color-border)] overflow-y-auto">
        <div className="p-3 space-y-2">
          {characters.map((char) => (
            <div key={char.id} className="group relative">
              <button
                onClick={() => setPickedId(char.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors ${
                  effectiveId === char.id
                    ? 'bg-blue-50 border border-[var(--color-primary)]'
                    : 'hover:bg-gray-50 border border-transparent'
                }`}
              >
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {char.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={char.avatar} alt={char.name} className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-5 h-5 text-gray-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{char.name}</div>
                  <div className="text-xs text-[var(--color-text-secondary)] line-clamp-2 mt-0.5">
                    {char.description || '暂无描述'}
                  </div>
                </div>
              </button>
              <button
                onClick={() => handleDelete(char.id)}
                disabled={actionBusy === `del-${char.id}`}
                className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-[var(--color-danger)] hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="删除角色"
              >
                {actionBusy === `del-${char.id}` ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ))}

          {/* "添加角色" card at bottom (likeai pattern) */}
          <button
            onClick={() => setShowAdd(true)}
            className="add-character-card w-full flex flex-col items-center justify-center gap-1 p-3 rounded-xl border border-dashed border-gray-300 text-gray-500 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span className="text-sm">添加角色</span>
          </button>
        </div>
      </div>

      {/* Right detail */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <CharacterDetail
            key={selected.id}
            character={selected}
            project={project}
            onUpdated={(updated) => {
              onChange(characters.map((c) => (c.id === updated.id ? updated : c)));
            }}
            onStyleChanged={() => void reload()}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
            {project.basicAnalysis === 'completed'
              ? '尚未生成角色，点击左侧"添加角色"创建'
              : '正在分析角色…'}
          </div>
        )}
        {actionError && <div className="px-6 py-2 text-sm text-red-600">{actionError}</div>}
      </div>

      <AddCharacterModal
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}

interface DetailProps {
  character: Character;
  project: Project;
  onUpdated: (next: Character) => void;
  onStyleChanged: () => void;
}

function CharacterDetail({ character, project, onUpdated, onStyleChanged }: DetailProps) {
  // Whether this character is in the "fresh, unanalysed" state.
  // Characters created by episode analysis have a short description but no
  // styles yet — they should also see the analyze/blank choice.
  const isFresh = !character.markedBlank && character.styles.length === 0;

  const [analyzing, setAnalyzing] = useState(false);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const updated = await analyzeCharacter(character.id);
      onUpdated(updated);
    } catch (e) {
      // Keep the character in fresh state so the user can retry.
      throw e;
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCreateBlank = async () => {
    const updated = await updateCharacter(character.id, { markedBlank: true });
    onUpdated(updated);
  };

  if (isFresh) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
          {/* Placeholder avatar */}
          <div className="w-48 h-48 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400">
            <User className="w-16 h-16" />
          </div>

          <div className="text-center max-w-md">
            <div className="font-semibold text-lg">{character.name}</div>
            <div className="text-sm text-[var(--color-text-secondary)] mt-1">
              {character.description.trim() || '暂无描述'}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {analyzing ? '分析中…' : '分析角色'}
            </button>
            <button
              onClick={handleCreateBlank}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg border border-[var(--color-border)] hover:bg-gray-50"
            >
              创建为空白角色
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <CharacterEditableDetail character={character} project={project} onUpdated={onUpdated} onStyleChanged={onStyleChanged} />;
}

function CharacterEditableDetail({
  character,
  project,
  onUpdated,
  onStyleChanged,
}: DetailProps) {
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAvatarUpload = async (file: File) => {
    setAvatarBusy(true);
    setError(null);
    try {
      const asset = await uploadAsset(file);
      const updated = await updateCharacter(character.id, { avatarAssetId: asset.id });
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : '更换头像失败');
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleGenerateAvatar = async () => {
    setGenBusy(true);
    setError(null);
    try {
      const prompt = [
        `角色：${character.name}`,
        character.description ? `描述：${character.description}` : '',
        character.bio ? `背景：${character.bio}` : '',
        '输出：单人头像，半身像，正面，正常表情，光线自然',
        project.stylePrompt ? `风格指引：${project.stylePrompt}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const task = await createImageTask(
        project.id,
        { prompt, ratio: '1:1', model: project.imageModel, n: 1 },
        imageProviderForModel(project.imageModel),
      );
      const final = await pollTaskUntilDone(task.id, { intervalMs: 2000 });
      if (final.status !== 'SUCCEEDED' || !final.outputAssets?.[0]) {
        throw new Error(final.error || '生成失败');
      }
      const updated = await updateCharacter(character.id, {
        avatarAssetId: final.outputAssets[0].id,
      });
      onUpdated(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setGenBusy(false);
    }
  };

  const handleSaveText = async (field: 'name' | 'description' | 'bio' | 'voice', value: string) => {
    const updated = await updateCharacter(character.id, { [field]: value });
    onUpdated(updated);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-stretch gap-5">
        <div className="relative w-40 rounded-2xl overflow-hidden flex-shrink-0 self-stretch">
          <div className="w-full h-full bg-gray-100 flex items-center justify-center">
            {character.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={character.avatar} alt={character.name} className="w-full h-full object-cover" />
            ) : (
              <div className="flex items-center justify-center text-gray-400">
                <User className="w-16 h-16" />
              </div>
            )}
            {(avatarBusy || genBusy) && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-white animate-spin" />
              </div>
            )}
          </div>
          <div className="absolute bottom-2 right-2 flex gap-1">
            <button
              type="button"
              onClick={() => avatarFileRef.current?.click()}
              disabled={avatarBusy || genBusy}
              className="w-7 h-7 rounded-md bg-white shadow-sm text-gray-700 hover:text-[var(--color-primary)] flex items-center justify-center"
              title="上传头像"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleGenerateAvatar}
              disabled={avatarBusy || genBusy}
              className="w-7 h-7 rounded-md bg-white shadow-sm text-gray-700 hover:text-[var(--color-primary)] flex items-center justify-center"
              title="AI 生成头像"
            >
              <Sparkles className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            ref={avatarFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleAvatarUpload(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className="flex-1 space-y-3">
          <InlineText label="名称" value={character.name} onSave={(v) => handleSaveText('name', v)} />
          <InlineText
            label="音色"
            value={character.voice ?? ''}
            placeholder="点击编辑音色（可选）"
            onSave={(v) => handleSaveText('voice', v)}
          />
          <InlineText
            label="简介"
            value={character.bio || character.description}
            multiline
            placeholder="性格、背景、动机…"
            onSave={(v) => handleSaveText('bio', v)}
          />
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="border-t border-[var(--color-border)] pt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">造型</h3>
        </div>
        <CharacterStylesGrid character={character} project={project} onChanged={onStyleChanged} />
      </div>
    </div>
  );
}

function InlineText({
  label,
  value,
  multiline,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  placeholder?: string;
  onSave: (next: string) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(value), [value]);

  const commit = async () => {
    if (draft === value) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start gap-3">
      <label className="text-sm text-[var(--color-text-secondary)] pt-2 whitespace-nowrap">{label}</label>
      <div className="flex-1">
        {multiline ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            rows={3}
            disabled={saving}
            placeholder={placeholder}
            className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 focus:border-[var(--color-primary)] focus:bg-white outline-none text-sm resize-none transition-colors"
          />
        ) : (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commit();
            }}
            disabled={saving}
            placeholder={placeholder}
            className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 focus:border-[var(--color-primary)] focus:bg-white outline-none text-sm transition-colors"
          />
        )}
        {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
      </div>
    </div>
  );
}

interface StylesProps {
  character: Character;
  project: Project;
  onChanged: () => void;
}

function CharacterStylesGrid({ character, project, onChanged }: StylesProps) {
  const [error, setError] = useState<string | null>(null);
  const [openStyleId, setOpenStyleId] = useState<string | null>(null);

  const handleAddBlankStyle = async () => {
    setError(null);
    try {
      const styleName = `造型${character.styles.length + 1}`;
      const created = await createCharacterStyle(character.id, {
        name: styleName,
        prompt: '',
        model: project.imageModel,
        ratio: '9:16',
      });
      await onChanged();
      setOpenStyleId(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建造型失败');
    }
  };

  const handleDeleteStyle = async (styleId: string) => {
    if (!confirm('确认删除该造型？')) return;
    try {
      await deleteCharacterStyle(styleId);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  };

  const opened = openStyleId ? character.styles.find((s) => s.id === openStyleId) ?? null : null;

  const buildStyleAutoPrompt = (style: NonNullable<typeof opened>): string => {
    return [
      `角色：${character.name}`,
      character.description ? `描述：${character.description}` : '',
      character.bio ? `背景：${character.bio}` : '',
      `造型：${style.name}`,
      '输出：全身造型图，单人，纯色背景，光线自然，比例标准',
      project.stylePrompt ? `风格指引：${project.stylePrompt}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-6 gap-3">
        {character.styles.map((style, idx) => (
          <div
            key={style.id ?? idx}
            className="group relative rounded-xl overflow-hidden bg-gray-100 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => style.id && setOpenStyleId(style.id)}
          >
            <div className="aspect-video flex items-center justify-center">
              {style.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={style.image} alt={style.name} className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center text-gray-400">
                  <ImagePlus className="w-8 h-8" />
                  <span className="text-[11px] mt-1">点击编辑</span>
                </div>
              )}
            </div>
            <div className="px-2 py-1 bg-gray-700 text-white text-[11px] text-center truncate">
              {style.name}
            </div>
            {style.id && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (style.id) void handleDeleteStyle(style.id);
                }}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-white/85 text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}

        {/* "+ 添加造型" tile — opens a blank style detail page */}
        <button
          onClick={handleAddBlankStyle}
          className="aspect-video rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
        >
          <Plus className="w-5 h-5" />
          <span className="text-xs">添加造型</span>
        </button>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      {opened && opened.id && (
        <EntityDetailDrawer
          open
          kind="style"
          entity={{
            id: opened.id,
            name: opened.name,
            prompt: opened.prompt ?? '',
            model: opened.model ?? null,
            ratio: opened.ratio ?? null,
            image: opened.image,
          }}
          project={project}
          characterId={character.id}
          buildAutoPrompt={() => buildStyleAutoPrompt(opened)}
          onSave={async (patch) => {
            const fresh = await updateCharacterStyle(opened.id!, patch);
            await onChanged();
            return {
              id: fresh.id,
              name: fresh.name,
              prompt: fresh.prompt,
              model: fresh.model,
              ratio: fresh.ratio,
              image: fresh.image,
            };
          }}
          onDelete={async () => {
            await deleteCharacterStyle(opened.id!);
            await onChanged();
          }}
          onClose={() => setOpenStyleId(null)}
        />
      )}
    </div>
  );
}
