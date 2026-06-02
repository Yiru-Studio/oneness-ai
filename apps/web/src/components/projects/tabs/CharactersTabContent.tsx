'use client';

import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { Character, Project } from '@/types';
import { User, ImagePlus, Plus, Trash2, Sparkles, Loader2, Pencil, AlertCircle } from 'lucide-react';
import {
  createCharacter,
  updateCharacter,
  deleteCharacter,
  createCharacterStyle,
  updateCharacterStyle,
  deleteCharacterStyle,
  getProjectCharacters,
  analyzeCharacter,
} from '@/lib/api';
import { AddCharacterModal } from '@/components/modals/AddCharacterModal';
import { EntityDetailDrawer } from '@/components/projects/EntityDetailDrawer';
import { useGeneration } from '@/contexts/GenerationContext';
import { buildResourceImagePrompt } from '@oneness/shared/resource-prompts';

interface Props {
  characters: Character[];
  project: Project;
  scriptContent?: string;
  onChange: Dispatch<SetStateAction<Character[]>>;
}

function avatarTaskState(
  character: Character,
  inSessionGenerating: boolean,
  inSessionError: string | null,
): { pending: boolean; failed: boolean; error: string | null; title: string | undefined } {
  const row = character.avatarResourceImage;
  const queued = row?.status === 'QUEUED';
  const running = row?.status === 'RUNNING';
  const pending = inSessionGenerating || queued || running;
  const persistedError = row?.status === 'FAILED' ? row.error || '头像生成失败' : null;
  const error = inSessionError || persistedError;
  const failed = !pending && Boolean(error);
  const statusLabel = queued
    ? row?.error
      ? '头像重试排队中'
      : '头像排队中'
    : running || inSessionGenerating
      ? '头像生成中'
      : failed
        ? `头像生成失败：${error}`
        : undefined;
  return { pending, failed, error, title: statusLabel };
}

type CharacterStyle = Character['styles'][number];

function styleDisplayImage(style: CharacterStyle): string {
  return style.image || style.styleResourceImage?.image || '';
}

function styleDisplayAssetId(style: CharacterStyle): string | null {
  return style.assetId ?? style.styleResourceImage?.assetId ?? null;
}

function styleTaskState(
  style: CharacterStyle,
  inSessionGenerating: boolean,
  inSessionError: string | null,
): { pending: boolean; failed: boolean; error: string | null; label: string | null; title: string | undefined } {
  const row = style.styleResourceImage;
  const queued = row?.status === 'QUEUED';
  const running = row?.status === 'RUNNING';
  const pending = inSessionGenerating || queued || running;
  const persistedError = row?.status === 'FAILED' ? row.error || '造型图生成失败' : null;
  const error = inSessionError || persistedError;
  const failed = !pending && Boolean(error);
  const label = queued
    ? '排队中'
    : running || inSessionGenerating
      ? '生成中'
      : failed
        ? '生成失败'
        : null;
  const title = label ? `${style.name}：${failed && error ? `${label}，${error}` : label}` : undefined;
  return { pending, failed, error, label, title };
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
  const { isGenerating, getError } = useGeneration();

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
      const nextSelectedId = characters.find((c) => c.id !== charId)?.id ?? null;
      onChange((prev) => prev.filter((c) => c.id !== charId));
      if (effectiveId === charId) setPickedId(nextSelectedId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setActionBusy(null);
    }
  };

  useEffect(() => {
    const hasPendingAvatar = characters.some((char) =>
      isGenerating('character-avatar', char.id) ||
      char.avatarResourceImage?.status === 'QUEUED' ||
      char.avatarResourceImage?.status === 'RUNNING',
    );
    if (!hasPendingAvatar) return;

    const timer = window.setInterval(() => {
      void getProjectCharacters(project.id).then(onChange).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [characters, isGenerating, onChange, project.id]);

  return (
    <div className="flex h-full">
      {/* Left list */}
      <div className="w-[280px] flex-shrink-0 border-r border-[var(--color-border)] overflow-y-auto">
        <div className="p-3 space-y-2">
          {characters.map((char) => {
            const avatarTask = avatarTaskState(
              char,
              isGenerating('character-avatar', char.id),
              getError('character-avatar', char.id),
            );
            return (
            <div key={char.id} className="group relative">
              <button
                onClick={() => setPickedId(char.id)}
                title={avatarTask.title}
                className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors ${
                  effectiveId === char.id
                    ? 'bg-blue-50 border border-[var(--color-primary)]'
                    : 'hover:bg-gray-50 border border-transparent'
                }`}
              >
                <div className="relative w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {char.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={char.avatar} alt={char.name} className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-5 h-5 text-gray-400" />
                  )}
                  {avatarTask.pending && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                    </div>
                  )}
                  {avatarTask.failed && (
                    <div className="absolute -right-0.5 -bottom-0.5 w-4 h-4 rounded-full bg-red-600 text-white flex items-center justify-center ring-2 ring-white">
                      <AlertCircle className="w-3 h-3" />
                    </div>
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
            );
          })}

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
              onChange((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
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
  const { runGeneration, getError, clearError } = useGeneration();
  const analyzeError = getError('character-avatar', character.id);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    clearError('character-avatar', character.id);
    try {
      // Reuse the avatar-generation loading channel so the left-panel avatar
      // slot shows the same spinner during script/character analysis.
      const updated = await runGeneration('character-avatar', character.id, () =>
        analyzeCharacter(character.id),
      );
      onUpdated(updated);
    } catch {
      // Keep the character in fresh state so the user can retry; the error is
      // surfaced via the generation context.
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
          {analyzeError && (
            <div className="max-w-md rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {analyzeError}
            </div>
          )}
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
  const [error, setError] = useState<string | null>(null);
  const [avatarDrawerOpen, setAvatarDrawerOpen] = useState(false);
  const { isGenerating, getError } = useGeneration();
  const genBusy = isGenerating('character-avatar', character.id);
  const remoteError = getError('character-avatar', character.id);

  const handleSaveText = async (field: 'name' | 'description' | 'bio' | 'voice', value: string) => {
    const updated = await updateCharacter(character.id, { [field]: value });
    onUpdated(updated);
  };

  const buildAvatarAutoPrompt = () => {
    if (character.avatarPrompt) return character.avatarPrompt;
    return buildResourceImagePrompt({
      kind: 'character-avatar',
      name: character.name,
      description: character.description,
      bio: character.bio,
      projectStylePrompt: project.stylePrompt,
      ratio: project.ratio,
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-stretch gap-5">
        <div className="relative w-40 rounded-2xl overflow-hidden flex-shrink-0 self-stretch">
          <button
            type="button"
            onClick={() => setAvatarDrawerOpen(true)}
            className="w-full h-full bg-gray-100 flex items-center justify-center cursor-pointer hover:bg-gray-200 transition-colors"
          >
            {character.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={character.avatar} alt={character.name} className="w-full h-full object-cover" />
            ) : (
              <div className="flex items-center justify-center text-gray-400">
                <User className="w-16 h-16" />
              </div>
            )}
          </button>
          {genBusy && (
            <div className="pointer-events-none absolute inset-0 bg-black/40 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-white animate-spin" />
            </div>
          )}
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

      {(error || remoteError) && (
        <div className="text-sm text-red-600">{error || remoteError}</div>
      )}

      <EntityDetailDrawer
        open={avatarDrawerOpen}
        kind="character-avatar"
        entity={{
          id: character.id,
          name: character.name,
          description: character.description,
            prompt: character.avatarPrompt ?? '',
            model: null,
            ratio: project.ratio,
            image: character.avatar,
            assetId: character.avatarAssetId ?? null,
          }}
        project={project}
        characterId={character.id}
        buildAutoPrompt={buildAvatarAutoPrompt}
        onSave={async (patch) => {
          const data: Partial<{
            name: string;
            description: string;
            avatarPrompt: string | null;
            avatarAssetId: string | null;
            identityAssetId: string | null;
          }> = {};
          if (patch.name !== undefined) data.name = patch.name;
          if (patch.description !== undefined) data.description = patch.description;
          if (patch.prompt !== undefined) data.avatarPrompt = patch.prompt;
          if (patch.assetId !== undefined) {
            data.avatarAssetId = patch.assetId ?? null;
            data.identityAssetId = patch.assetId ?? null;
          }
          const fresh = await updateCharacter(character.id, data);
          onUpdated(fresh);
          return {
            id: fresh.id,
            name: fresh.name,
            description: fresh.description,
            prompt: fresh.avatarPrompt ?? '',
            model: null,
            ratio: project.ratio,
            image: fresh.avatar,
            assetId: fresh.avatarAssetId ?? null,
          };
        }}
        onClose={() => setAvatarDrawerOpen(false)}
      />

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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDraft(value);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [value]);

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
  const { isGenerating, getError } = useGeneration();

  const handleAddBlankStyle = async () => {
    setError(null);
    try {
      const styleName = `造型${character.styles.length + 1}`;
      const created = await createCharacterStyle(character.id, {
        name: styleName,
        prompt: '',
        model: project.imageModel,
        ratio: project.ratio,
      });
      await onChanged();
      setOpenStyleId(created.id ?? null);
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

  useEffect(() => {
    const hasPendingStyles = character.styles.some((style) =>
      Boolean(style.id && isGenerating('style', style.id)) ||
      style.styleResourceImage?.status === 'QUEUED' ||
      style.styleResourceImage?.status === 'RUNNING',
    );
    if (!hasPendingStyles) return;

    const timer = window.setInterval(() => {
      void onChanged();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [character.styles, isGenerating, onChanged]);

  const buildStyleAutoPrompt = (style: NonNullable<typeof opened>): string => {
    return buildResourceImagePrompt({
      kind: 'character-style',
      name: character.name,
      description: character.description,
      bio: character.bio,
      styleName: style.name,
      userPrompt: style.prompt,
      projectStylePrompt: project.stylePrompt,
      ratio: style.ratio || project.ratio,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-6 gap-3">
        {character.styles.map((style, idx) => {
          const displayImage = styleDisplayImage(style);
          const taskState = style.id
            ? styleTaskState(style, isGenerating('style', style.id), getError('style', style.id))
            : { pending: false, failed: false, error: null, label: null, title: undefined };
          return (
            <div
              key={style.id ?? idx}
              title={taskState.title}
              className="group relative rounded-xl overflow-hidden bg-gray-100 cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => style.id && setOpenStyleId(style.id)}
            >
              <div className="relative aspect-video flex items-center justify-center">
                {displayImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={displayImage} alt={style.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center text-gray-400">
                    <ImagePlus className="w-8 h-8" />
                    <span className="text-[11px] mt-1">{taskState.label || '点击编辑'}</span>
                  </div>
                )}
                {taskState.pending && (
                  <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1 text-white">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-[11px] font-medium">{taskState.label}</span>
                  </div>
                )}
                {taskState.failed && (
                  <div
                    className="absolute right-1.5 top-1.5 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center shadow-sm"
                    title={taskState.error ?? undefined}
                  >
                    <AlertCircle className="w-3 h-3" />
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
          );
        })}

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
            image: styleDisplayImage(opened),
            assetId: styleDisplayAssetId(opened),
          }}
          project={project}
          characterId={character.id}
          identityReferenceAssetId={character.identityAssetId ?? character.avatarAssetId ?? null}
          buildAutoPrompt={() => buildStyleAutoPrompt(opened)}
          onSave={async (patch) => {
            const fresh = await updateCharacterStyle(opened.id!, patch);
            await onChanged();
            return {
              id: fresh.id ?? opened.id!,
              name: fresh.name,
              prompt: fresh.prompt,
              model: fresh.model,
              ratio: fresh.ratio,
              image: styleDisplayImage(fresh),
              assetId: styleDisplayAssetId(fresh),
            };
          }}
          onDelete={async () => {
            await deleteCharacterStyle(opened.id!);
            await onChanged();
          }}
          allowBackgroundInteraction
          onClose={() => setOpenStyleId(null)}
        />
      )}
    </div>
  );
}
