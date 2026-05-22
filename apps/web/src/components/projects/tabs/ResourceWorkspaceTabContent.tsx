'use client';

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  History,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Package,
  PencilLine,
  Plus,
  RefreshCcw,
  Sparkles,
  Upload,
  User,
  Wand2,
  X,
} from 'lucide-react';
import {
  Character,
  Item,
  Project,
  ResourceImage,
  ResourceImageKind,
  ResourcePromptStatus,
  ResourceReviewStatus,
  Scene,
} from '@/types';
import {
  createCharacter,
  createCharacterStyle,
  createImageTask,
  createItem,
  createResourceImage,
  createScene,
  deleteCharacter,
  deleteItem,
  deleteScene,
  getProjectCharacters,
  getProjectItems,
  getProjectScenes,
  getResourceImages,
  generateResourcePrompt,
  pollTaskUntilDone,
  updateCharacter,
  updateCharacterStyle,
  updateItem,
  updateResourceImage,
  updateScene,
  uploadAsset,
} from '@/lib/api';
import {
  IMAGE_MODEL_OPTIONS,
  imageProviderForModel,
} from '@/data/style-presets';
import { ImagePreview } from '@/components/ImagePreview';
import { THREE_VIEW_MARKER } from '@/components/projects/EntityDetailDrawer';

type ResourceMode = 'characters' | 'scenes' | 'items';

interface Props {
  characters: Character[];
  scenes: Scene[];
  items: Item[];
  project: Project;
  scriptContent?: string;
  onCharactersChange: (next: Character[]) => void;
  onScenesChange: (next: Scene[]) => void;
  onItemsChange: (next: Item[]) => void;
}

type WorkspaceTarget = {
  kind: ResourceImageKind;
  entityId: string;
  title: string;
  description: string;
  image: string;
  assetId: string | null;
  prompt: string;
  model: string | null;
  ratio: string | null;
  reviewStatus: ResourceReviewStatus;
  promptStatus: ResourcePromptStatus;
  promptTaskId?: string | null;
  promptError?: string | null;
  characterId?: string;
};

type CharacterStyle = Character['styles'][number];

type BulkGenerationTarget = {
  kind: ResourceImageKind;
  entityId: string;
  title: string;
  description: string;
  prompt: string;
  model: string;
  ratio: string;
  characterId?: string;
  styleName?: string;
};

type WorkflowStage =
  | 'needs-review'
  | 'needs-prompt'
  | 'prompt-running'
  | 'prompt-failed'
  | 'needs-image'
  | 'image-running'
  | 'refine';

const MODES: Array<{ value: ResourceMode; label: string; icon: React.ElementType }> = [
  { value: 'characters', label: '人物', icon: User },
  { value: 'scenes', label: '场景', icon: ImageIcon },
  { value: 'items', label: '道具', icon: Package },
];

const RATIO_OPTIONS = [
  { value: '1:1', label: '1:1 方形' },
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];

function parseThreeViewPrompt(raw: string): { threeView: boolean; body: string } {
  const re = new RegExp(`^${THREE_VIEW_MARKER}\\s*\\n?`);
  if (re.test(raw)) return { threeView: true, body: raw.replace(re, '') };
  return { threeView: false, body: raw };
}

function composeThreeViewPrompt(threeView: boolean, body: string): string {
  if (!threeView) return body;
  return body ? `${THREE_VIEW_MARKER}\n${body}` : THREE_VIEW_MARKER;
}

function nextStyleName(styles: Character['styles']): string {
  if (styles.length === 0) return '默认造型';
  const names = new Set(styles.map((style) => style.name).filter(Boolean));
  for (let index = styles.length + 1; index < styles.length + 100; index += 1) {
    const candidate = `造型 ${index}`;
    if (!names.has(candidate)) return candidate;
  }
  return `造型 ${Date.now()}`;
}

function hasResourceImage(assetId?: string | null, image?: string): boolean {
  return Boolean(assetId || image);
}

function resourceHistoryKey(kind: ResourceImageKind, entityId: string): string {
  return `${kind}:${entityId}`;
}

function isPendingStatus(status?: string | null): boolean {
  return status === 'QUEUED' || status === 'RUNNING';
}

function stageLabel(stage: WorkflowStage): string {
  switch (stage) {
    case 'needs-review':
      return '待确认';
    case 'needs-prompt':
      return '待生成提示词';
    case 'prompt-running':
      return '提示词生成中';
    case 'prompt-failed':
      return '提示词失败';
    case 'needs-image':
      return '待生成图片';
    case 'image-running':
      return '图片生成中';
    case 'refine':
      return '可精修';
  }
}

function stageClassName(stage: WorkflowStage): string {
  if (stage === 'refine') return 'bg-green-50 text-green-700 border-green-100';
  if (stage === 'prompt-failed') return 'bg-red-50 text-red-700 border-red-100';
  if (stage === 'prompt-running' || stage === 'image-running') {
    return 'bg-blue-50 text-blue-700 border-blue-100';
  }
  return 'bg-amber-50 text-amber-700 border-amber-100';
}

function stageForImageResource(resource: {
  reviewStatus?: ResourceReviewStatus;
  promptStatus?: ResourcePromptStatus;
  prompt?: string;
  assetId?: string | null;
  image?: string;
}): WorkflowStage {
  if (resource.reviewStatus !== 'CONFIRMED') return 'needs-review';
  if (hasResourceImage(resource.assetId, resource.image)) return 'refine';
  const promptStatus = resource.promptStatus ?? (resource.prompt ? 'READY' : 'EMPTY');
  if (promptStatus === 'QUEUED' || promptStatus === 'RUNNING') return 'prompt-running';
  if (promptStatus === 'FAILED') return 'prompt-failed';
  if (!resource.prompt?.trim()) return 'needs-prompt';
  if (!hasResourceImage(resource.assetId, resource.image)) return 'needs-image';
  return 'refine';
}

function stageForCharacter(character: Character): WorkflowStage {
  if (character.reviewStatus !== 'CONFIRMED') return 'needs-review';
  const firstStyle = character.styles.find((style) => Boolean(style.id));
  if (!firstStyle) return 'needs-prompt';
  return stageForImageResource({
    reviewStatus: character.reviewStatus,
    promptStatus: firstStyle.promptStatus,
    prompt: firstStyle.prompt,
    assetId: firstStyle.assetId,
    image: firstStyle.image,
  });
}

export function ResourceWorkspaceTabContent({
  characters,
  scenes,
  items,
  project,
  scriptContent,
  onCharactersChange,
  onScenesChange,
  onItemsChange,
}: Props) {
  const [mode, setMode] = useState<ResourceMode>('characters');
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [history, setHistory] = useState<ResourceImage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<ResourceMode | null>(null);
  const [drawer, setDrawer] = useState<null | 'info' | 'records'>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);

  const [styleNameDraft, setStyleNameDraft] = useState('');
  const [resourceNameDraft, setResourceNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [promptBody, setPromptBody] = useState('');
  const [threeView, setThreeView] = useState(false);
  const [modelDraft, setModelDraft] = useState(project.imageModel);
  const [ratioDraft, setRatioDraft] = useState(project.ratio);
  const [referenceAssetId, setReferenceAssetId] = useState<string | null>(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState('');

  const uploadRef = useRef<HTMLInputElement>(null);
  const referenceRef = useRef<HTMLInputElement>(null);
  const activeHistoryKeyRef = useRef<string | null>(null);

  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === selectedCharacterId) ?? characters[0] ?? null,
    [characters, selectedCharacterId],
  );
  const selectedStyle = useMemo(() => {
    if (!selectedCharacter) return null;
    return (
      selectedCharacter.styles.find((s) => s.id === selectedStyleId) ??
      selectedCharacter.styles.find((s) => Boolean(s.id)) ??
      null
    );
  }, [selectedCharacter, selectedStyleId]);
  const selectedScene = useMemo(
    () => scenes.find((s) => s.id === selectedSceneId) ?? scenes[0] ?? null,
    [scenes, selectedSceneId],
  );
  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedItemId) ?? items[0] ?? null,
    [items, selectedItemId],
  );

  useEffect(() => {
    if (!selectedCharacterId && characters[0]) setSelectedCharacterId(characters[0].id);
    if (!selectedSceneId && scenes[0]) setSelectedSceneId(scenes[0].id);
    if (!selectedItemId && items[0]) setSelectedItemId(items[0].id);
  }, [characters, items, scenes, selectedCharacterId, selectedItemId, selectedSceneId]);

  useEffect(() => {
    if (!selectedCharacter) {
      setSelectedStyleId(null);
      return;
    }
    const hasSelected = selectedCharacter.styles.some((s) => s.id === selectedStyleId);
    if (!hasSelected) setSelectedStyleId(selectedCharacter.styles.find((s) => Boolean(s.id))?.id ?? null);
  }, [selectedCharacter, selectedStyleId]);

  const target: WorkspaceTarget | null = useMemo(() => {
    if (mode === 'characters') {
      if (!selectedCharacter || !selectedStyle?.id) return null;
      return {
        kind: 'character-style',
        entityId: selectedStyle.id,
        title: selectedStyle.name,
        description: selectedCharacter.description || selectedCharacter.bio || '',
        image: selectedStyle.image,
        assetId: selectedStyle.assetId ?? null,
        prompt: selectedStyle.prompt ?? '',
        model: selectedStyle.model ?? null,
        ratio: selectedStyle.ratio ?? null,
        reviewStatus: selectedCharacter.reviewStatus ?? 'NEEDS_REVIEW',
        promptStatus: selectedStyle.promptStatus ?? (selectedStyle.prompt ? 'READY' : 'EMPTY'),
        promptTaskId: selectedStyle.promptTaskId ?? null,
        promptError: selectedStyle.promptError ?? null,
        characterId: selectedCharacter.id,
      };
    }
    if (mode === 'scenes') {
      if (!selectedScene) return null;
      return {
        kind: 'scene',
        entityId: selectedScene.id,
        title: selectedScene.name,
        description: selectedScene.description ?? '',
        image: selectedScene.image,
        assetId: selectedScene.assetId ?? null,
        prompt: selectedScene.prompt ?? '',
        model: selectedScene.model ?? null,
        ratio: selectedScene.ratio ?? null,
        reviewStatus: selectedScene.reviewStatus ?? 'NEEDS_REVIEW',
        promptStatus: selectedScene.promptStatus ?? (selectedScene.prompt ? 'READY' : 'EMPTY'),
        promptTaskId: selectedScene.promptTaskId ?? null,
        promptError: selectedScene.promptError ?? null,
      };
    }
    if (!selectedItem) return null;
    return {
      kind: 'item',
      entityId: selectedItem.id,
      title: selectedItem.name,
      description: selectedItem.description ?? '',
      image: selectedItem.image,
      assetId: selectedItem.assetId ?? null,
      prompt: selectedItem.prompt ?? '',
      model: selectedItem.model ?? null,
      ratio: selectedItem.ratio ?? null,
      reviewStatus: selectedItem.reviewStatus ?? 'NEEDS_REVIEW',
      promptStatus: selectedItem.promptStatus ?? (selectedItem.prompt ? 'READY' : 'EMPTY'),
      promptTaskId: selectedItem.promptTaskId ?? null,
      promptError: selectedItem.promptError ?? null,
    };
  }, [mode, selectedCharacter, selectedItem, selectedScene, selectedStyle]);

  useEffect(() => {
    if (!target) {
      activeHistoryKeyRef.current = null;
      setHistory([]);
      setHistoryLoading(false);
      return;
    }
    activeHistoryKeyRef.current = resourceHistoryKey(target.kind, target.entityId);
    setHistory([]);
    setHistoryLoading(true);
    setStyleNameDraft(target.title);
    setResourceNameDraft(mode === 'characters' ? selectedCharacter?.name ?? '' : target.title);
    setDescriptionDraft(target.description);
    const parsed = parseThreeViewPrompt(target.prompt);
    setThreeView(parsed.threeView);
    setPromptBody(parsed.body);
    setModelDraft(target.model || project.imageModel);
    setRatioDraft(target.ratio || project.ratio);
    setReferenceAssetId(null);
    setReferenceImageUrl('');
    void refreshHistory(target.kind, target.entityId);
  }, [target?.kind, target?.entityId]);

  useEffect(() => {
    if (target || mode !== 'characters' || !selectedCharacter) return;
    setResourceNameDraft(selectedCharacter.name);
    setDescriptionDraft(selectedCharacter.description || selectedCharacter.bio || '');
  }, [mode, selectedCharacter?.id, target?.entityId]);

  async function refreshHistory(kind: ResourceImageKind, entityId: string) {
    const key = resourceHistoryKey(kind, entityId);
    if (activeHistoryKeyRef.current !== key) return;
    setHistoryLoading(true);
    try {
      const rows = await getResourceImages(kind, entityId);
      if (activeHistoryKeyRef.current === key) setHistory(rows);
    } catch (e) {
      if (activeHistoryKeyRef.current === key) {
        setError(e instanceof Error ? e.message : '图片历史加载失败');
      }
    } finally {
      if (activeHistoryKeyRef.current === key) setHistoryLoading(false);
    }
  }

  const reloadCharacters = async () => {
    const fresh = await getProjectCharacters(project.id);
    onCharactersChange(fresh);
    return fresh;
  };

  const reloadScenes = async () => {
    const fresh = await getProjectScenes(project.id);
    onScenesChange(fresh);
    return fresh;
  };

  const reloadItems = async () => {
    const fresh = await getProjectItems(project.id);
    onItemsChange(fresh);
    return fresh;
  };

  const reloadCurrentResources = async () => {
    if (mode === 'characters') return void (await reloadCharacters());
    if (mode === 'scenes') return void (await reloadScenes());
    return void (await reloadItems());
  };

  const batchCounts = useMemo(() => {
    if (mode === 'characters') {
      const needsReview = characters.filter((character) => character.reviewStatus !== 'CONFIRMED').length;
      const needsPrompt = characters.reduce((count, character) => {
        if (character.reviewStatus !== 'CONFIRMED') return count;
        const styles = character.styles.filter((style) => Boolean(style.id));
        if (styles.length === 0) return count + 1;
        return count + styles.filter((style) => {
          const status = style.promptStatus ?? (style.prompt ? 'READY' : 'EMPTY');
          return !isPendingStatus(status) && status !== 'READY';
        }).length;
      }, 0);
      const needsImage = characters.reduce((count, character) => {
        if (character.reviewStatus !== 'CONFIRMED') return count;
        return count + character.styles.filter((style) => {
          const status = style.promptStatus ?? (style.prompt ? 'READY' : 'EMPTY');
          return (
            Boolean(style.id) &&
            status === 'READY' &&
            Boolean(style.prompt?.trim()) &&
            !hasResourceImage(style.assetId, style.image)
          );
        }).length;
      }, 0);
      return { needsReview, needsPrompt, needsImage };
    }
    if (mode === 'scenes') {
      return {
        needsReview: scenes.filter((scene) => scene.reviewStatus !== 'CONFIRMED').length,
        needsPrompt: scenes.filter((scene) => {
          const status = scene.promptStatus ?? (scene.prompt ? 'READY' : 'EMPTY');
          return scene.reviewStatus === 'CONFIRMED' && !isPendingStatus(status) && status !== 'READY';
        }).length,
        needsImage: scenes.filter((scene) => {
          const status = scene.promptStatus ?? (scene.prompt ? 'READY' : 'EMPTY');
          return scene.reviewStatus === 'CONFIRMED' && status === 'READY' && Boolean(scene.prompt?.trim()) && !hasResourceImage(scene.assetId, scene.image);
        }).length,
      };
    }
    return {
      needsReview: items.filter((item) => item.reviewStatus !== 'CONFIRMED').length,
      needsPrompt: items.filter((item) => {
        const status = item.promptStatus ?? (item.prompt ? 'READY' : 'EMPTY');
        return item.reviewStatus === 'CONFIRMED' && !isPendingStatus(status) && status !== 'READY';
      }).length,
      needsImage: items.filter((item) => {
        const status = item.promptStatus ?? (item.prompt ? 'READY' : 'EMPTY');
        return item.reviewStatus === 'CONFIRMED' && status === 'READY' && Boolean(item.prompt?.trim()) && !hasResourceImage(item.assetId, item.image);
      }).length,
    };
  }, [characters, items, mode, scenes]);

  const persistMetadata = async () => {
    if (!target) return;
    const composedPrompt = composeThreeViewPrompt(threeView, promptBody);
    if (mode === 'characters') {
      const tasks: Array<Promise<unknown>> = [];
      if (selectedCharacter) {
        tasks.push(
          updateCharacter(selectedCharacter.id, {
            name: resourceNameDraft.trim() || selectedCharacter.name,
            description: descriptionDraft,
          }),
        );
      }
      if (selectedStyle?.id) {
        tasks.push(
          updateCharacterStyle(selectedStyle.id, {
            name: styleNameDraft.trim() || selectedStyle.name,
            prompt: composedPrompt,
            model: modelDraft,
            ratio: ratioDraft,
          }),
        );
      }
      await Promise.all(tasks);
      await reloadCharacters();
    } else if (mode === 'scenes' && selectedScene) {
      await updateScene(selectedScene.id, {
        name: resourceNameDraft.trim() || selectedScene.name,
        description: descriptionDraft,
        prompt: composedPrompt,
        model: modelDraft,
        ratio: ratioDraft,
      });
      await reloadScenes();
    } else if (mode === 'items' && selectedItem) {
      await updateItem(selectedItem.id, {
        name: resourceNameDraft.trim() || selectedItem.name,
        description: descriptionDraft,
        prompt: composedPrompt,
        model: modelDraft,
        ratio: ratioDraft,
      });
      await reloadItems();
    }
  };

  const handleConfirmResource = async () => {
    setBusy('confirm-resource');
    setError(null);
    try {
      if (mode === 'characters' && selectedCharacter) {
        await updateCharacter(selectedCharacter.id, {
          name: resourceNameDraft.trim() || selectedCharacter.name,
          description: descriptionDraft,
          reviewStatus: 'CONFIRMED',
        });
        if (!selectedStyle?.id) {
          const style = await createCharacterStyle(selectedCharacter.id, {
            name: nextStyleName(selectedCharacter.styles),
            prompt: '',
            model: project.imageModel,
            ratio: project.ratio,
          });
          setSelectedStyleId(style.id);
        }
        await reloadCharacters();
      } else if (mode === 'scenes' && selectedScene) {
        await updateScene(selectedScene.id, {
          name: resourceNameDraft.trim() || selectedScene.name,
          description: descriptionDraft,
          reviewStatus: 'CONFIRMED',
        });
        await reloadScenes();
      } else if (mode === 'items' && selectedItem) {
        await updateItem(selectedItem.id, {
          name: resourceNameDraft.trim() || selectedItem.name,
          description: descriptionDraft,
          reviewStatus: 'CONFIRMED',
        });
        await reloadItems();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '确认素材失败');
    } finally {
      setBusy(null);
    }
  };

  const handleGeneratePrompt = async () => {
    if (!target) return;
    setBusy('generate-prompt');
    setError(null);
    try {
      await persistMetadata();
      const task = await generateResourcePrompt(
        target.kind,
        target.entityId,
        project.analysisModel,
      );
      await reloadCurrentResources();
      const done = await pollTaskUntilDone(task.id, {
        intervalMs: 1500,
        onTick: () => {
          void reloadCurrentResources();
        },
      });
      await reloadCurrentResources();
      if (done.status !== 'SUCCEEDED') {
        setError(done.error || '提示词生成失败');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '提示词生成失败');
    } finally {
      setBusy(null);
    }
  };

  const handleCreateDefaultStyle = async () => {
    if (!selectedCharacter) return;
    setBusy('create-style');
    setError(null);
    try {
      const styleName = nextStyleName(selectedCharacter.styles);
      const style = await createCharacterStyle(selectedCharacter.id, {
        name: styleName,
        prompt: '',
        model: project.imageModel,
        ratio: project.ratio,
      });
      setSelectedStyleId(style.id);
      setStyleNameDraft(style.name);
      setDrawer('info');
      await reloadCharacters();
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建造型失败');
    } finally {
      setBusy(null);
    }
  };

  const handleAddResource = async (name: string) => {
    if (!addMode) return;
    setBusy(`add-${addMode}`);
    setError(null);
    try {
      if (addMode === 'characters') {
        const created = await createCharacter(project.id, {
          name,
          description: '',
          markedBlank: true,
        });
        setSelectedCharacterId(created.id);
        await reloadCharacters();
      } else if (addMode === 'scenes') {
        const created = await createScene(project.id, { name });
        setSelectedSceneId(created.id);
        await reloadScenes();
      } else {
        const created = await createItem(project.id, { name });
        setSelectedItemId(created.id);
        await reloadItems();
      }
      setAddMode(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
      throw e;
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteResource = async (kind: ResourceMode, id: string) => {
    const label = kind === 'characters' ? '人物' : kind === 'scenes' ? '场景' : '道具';
    if (!confirm(`确认删除该${label}？此操作不可撤销。`)) return;
    setBusy(`delete-${id}`);
    setError(null);
    try {
      if (kind === 'characters') {
        await deleteCharacter(id);
        const fresh = await reloadCharacters();
        setSelectedCharacterId(fresh[0]?.id ?? null);
      } else if (kind === 'scenes') {
        await deleteScene(id);
        const fresh = await reloadScenes();
        setSelectedSceneId(fresh[0]?.id ?? null);
      } else {
        await deleteItem(id);
        const fresh = await reloadItems();
        setSelectedItemId(fresh[0]?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(null);
    }
  };

  const buildAutoPrompt = () => {
    if (!target) return '';
    if (target.kind === 'character-style') {
      setThreeView(true);
      return;
    }
    const context = scriptContent
      ?.split(/\n+/)
      .filter((line) => line.includes(resourceNameDraft.trim()))
      .slice(0, 6)
      .join('\n');
    setPromptBody(
      [
        `${mode === 'scenes' ? '场景' : '道具'}：${resourceNameDraft.trim() || target.title}`,
        descriptionDraft ? `描述：${descriptionDraft}` : '',
        context ? `剧本节选：\n${context}` : '',
        mode === 'scenes'
          ? '输出：场景全景，光线明确，环境细节丰富'
          : '输出：单个道具特写，背景简洁，光线柔和，构图居中',
        project.stylePrompt ? `风格：${project.stylePrompt}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  };

  const hasPendingResourceImage = async (item: BulkGenerationTarget): Promise<boolean> => {
    const rows =
      target?.kind === item.kind && target.entityId === item.entityId
        ? history
        : await getResourceImages(item.kind, item.entityId);
    return rows.some((row) => row.status === 'QUEUED' || row.status === 'RUNNING');
  };

  const collectPromptTargets = async (): Promise<Array<{ kind: ResourceImageKind; entityId: string }>> => {
    if (mode === 'characters') {
      const next: Array<{ kind: ResourceImageKind; entityId: string }> = [];
      for (const character of characters) {
        if (character.reviewStatus !== 'CONFIRMED') continue;
        const styles = character.styles.filter((style): style is CharacterStyle & { id: string } =>
          Boolean(style.id),
        );
        if (styles.length === 0) {
          const style = await createCharacterStyle(character.id, {
            name: nextStyleName(character.styles),
            prompt: '',
            model: project.imageModel,
            ratio: project.ratio,
          });
          if (character.id === selectedCharacter?.id) {
            setSelectedStyleId(style.id);
          }
          next.push({ kind: 'character-style', entityId: style.id });
          continue;
        }
        for (const style of styles) {
          const status = style.promptStatus ?? (style.prompt ? 'READY' : 'EMPTY');
          if (isPendingStatus(status) || status === 'READY') continue;
          next.push({ kind: 'character-style', entityId: style.id });
        }
      }
      return next;
    }
    if (mode === 'scenes') {
      return scenes
        .filter((scene) => {
          const status = scene.promptStatus ?? (scene.prompt ? 'READY' : 'EMPTY');
          return scene.reviewStatus === 'CONFIRMED' && !isPendingStatus(status) && status !== 'READY';
        })
        .map((scene) => ({ kind: 'scene' as const, entityId: scene.id }));
    }
    return items
      .filter((item) => {
        const status = item.promptStatus ?? (item.prompt ? 'READY' : 'EMPTY');
        return item.reviewStatus === 'CONFIRMED' && !isPendingStatus(status) && status !== 'READY';
      })
      .map((item) => ({ kind: 'item' as const, entityId: item.id }));
  };

  const collectMissingImageTargets = (): BulkGenerationTarget[] => {
    if (mode === 'characters') {
      return characters.flatMap((character) => {
        if (character.reviewStatus !== 'CONFIRMED') return [];
        return character.styles
          .filter((style): style is CharacterStyle & { id: string } => Boolean(style.id))
          .filter((style) => {
            const status = style.promptStatus ?? (style.prompt ? 'READY' : 'EMPTY');
            return (
              status === 'READY' &&
              Boolean(style.prompt?.trim()) &&
              !hasResourceImage(style.assetId, style.image)
            );
          })
          .map((style) => ({
            kind: 'character-style' as const,
            entityId: style.id,
            title: character.name,
            description: character.description || character.bio || '',
            prompt: style.prompt ?? '',
            model: style.model || project.imageModel,
            ratio: style.ratio || project.ratio,
            characterId: character.id,
            styleName: style.name,
          }));
      });
    }
    if (mode === 'scenes') {
      return scenes
        .filter((scene) => {
          const status = scene.promptStatus ?? (scene.prompt ? 'READY' : 'EMPTY');
          return scene.reviewStatus === 'CONFIRMED' && status === 'READY' && Boolean(scene.prompt?.trim()) && !hasResourceImage(scene.assetId, scene.image);
        })
        .map((scene) => ({
          kind: 'scene' as const,
          entityId: scene.id,
          title: scene.name,
          description: scene.description ?? '',
          prompt: scene.prompt ?? '',
          model: scene.model || project.imageModel,
          ratio: scene.ratio || project.ratio,
        }));
    }
    return items
      .filter((item) => {
        const status = item.promptStatus ?? (item.prompt ? 'READY' : 'EMPTY');
        return item.reviewStatus === 'CONFIRMED' && status === 'READY' && Boolean(item.prompt?.trim()) && !hasResourceImage(item.assetId, item.image);
      })
      .map((item) => ({
        kind: 'item' as const,
        entityId: item.id,
        title: item.name,
        description: item.description ?? '',
        prompt: item.prompt ?? '',
        model: item.model || project.imageModel,
        ratio: item.ratio || project.ratio,
      }));
  };

  const handleConfirmAll = async () => {
    setBusy('bulk-confirm');
    setError(null);
    try {
      if (mode === 'characters') {
        await Promise.all(
          characters
            .filter((character) => character.reviewStatus !== 'CONFIRMED')
            .map((character) => updateCharacter(character.id, { reviewStatus: 'CONFIRMED' })),
        );
        await reloadCharacters();
      } else if (mode === 'scenes') {
        await Promise.all(
          scenes
            .filter((scene) => scene.reviewStatus !== 'CONFIRMED')
            .map((scene) => updateScene(scene.id, { reviewStatus: 'CONFIRMED' })),
        );
        await reloadScenes();
      } else {
        await Promise.all(
          items
            .filter((item) => item.reviewStatus !== 'CONFIRMED')
            .map((item) => updateItem(item.id, { reviewStatus: 'CONFIRMED' })),
        );
        await reloadItems();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '批量确认失败');
    } finally {
      setBusy(null);
      setBulkMenuOpen(false);
    }
  };

  const handleGeneratePrompts = async () => {
    setBusy('bulk-prompt');
    setError(null);
    try {
      if (target) await persistMetadata();
      const candidates = await collectPromptTargets();
      for (const item of candidates) {
        await generateResourcePrompt(item.kind, item.entityId, project.analysisModel);
      }
      await reloadCurrentResources();
      if (candidates.length === 0) {
        setError('当前类型没有需要生成提示词的素材');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '批量生成提示词失败');
    } finally {
      setBusy(null);
      setBulkMenuOpen(false);
    }
  };

  const handleGenerateMissingImages = async () => {
    setBusy('bulk-generate');
    setError(null);
    try {
      if (target) await persistMetadata();
      const candidates = collectMissingImageTargets();
      let queued = 0;
      let queuedCurrent = false;
      for (const item of candidates) {
        if (!item.prompt.trim()) continue;
        if (await hasPendingResourceImage(item)) continue;
        await createImageTask(
          project.id,
          {
            prompt: item.prompt,
            ratio: item.ratio,
            model: item.model,
            n: 1,
            ...(item.characterId ? { characterId: item.characterId } : {}),
          },
          imageProviderForModel(item.model),
          { kind: item.kind, entityId: item.entityId },
        );
        queued += 1;
        if (target?.kind === item.kind && target.entityId === item.entityId) {
          queuedCurrent = true;
        }
      }
      await reloadCurrentResources();
      if (target) {
        await refreshHistory(target.kind, target.entityId);
      }
      if (queuedCurrent) setDrawer('records');
      if (queued === 0) {
        setError('当前类型没有符合条件的缺图素材');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '批量生成失败');
    } finally {
      setBusy(null);
      setBulkMenuOpen(false);
    }
  };

  const runGenerate = async (prompt: string, model: string, ratio: string) => {
    if (!target) return;
    const runKey = resourceHistoryKey(target.kind, target.entityId);
    const effectivePrompt = prompt.trim();
    if (!effectivePrompt) {
      setError('请先填写提示词');
      return;
    }
    setBusy('generate');
    setError(null);
    try {
      await persistMetadata();
      const task = await createImageTask(
        project.id,
        {
          prompt: effectivePrompt,
          ratio,
          model,
          n: 1,
          ...(referenceAssetId ? { referenceAssetIds: [referenceAssetId] } : {}),
          ...(target.characterId ? { characterId: target.characterId } : {}),
        },
        imageProviderForModel(model),
        { kind: target.kind, entityId: target.entityId },
      );
      await refreshHistory(target.kind, target.entityId);
      const done = await pollTaskUntilDone(task.id, {
        intervalMs: 2000,
        onTick: () => {
          void refreshHistory(target.kind, target.entityId);
        },
      });
      await refreshHistory(target.kind, target.entityId);
      await reloadCurrentResources();
      if (done.status !== 'SUCCEEDED') {
        if (activeHistoryKeyRef.current === runKey) {
          setError(done.error || '生成失败');
        }
      }
    } catch (e) {
      if (activeHistoryKeyRef.current === runKey) {
        setError(e instanceof Error ? e.message : '生成失败');
      }
    } finally {
      setBusy(null);
    }
  };

  const handleGenerate = async () => {
    const prompt = composeThreeViewPrompt(threeView, promptBody);
    await runGenerate(prompt, modelDraft || project.imageModel, ratioDraft || project.ratio);
  };

  const handleUpload = async (file: File) => {
    if (!target) return;
    setBusy('upload');
    setError(null);
    try {
      await persistMetadata();
      const asset = await uploadAsset(file);
      await createResourceImage({
        kind: target.kind,
        entityId: target.entityId,
        source: 'upload',
        status: 'SUCCEEDED',
        prompt: composeThreeViewPrompt(threeView, promptBody),
        model: modelDraft,
        ratio: ratioDraft,
        assetId: asset.id,
        setAsCurrent: true,
      });
      await refreshHistory(target.kind, target.entityId);
      await reloadCurrentResources();
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败');
    } finally {
      setBusy(null);
    }
  };

  const handleUploadReference = async (file: File) => {
    setBusy('reference');
    setError(null);
    try {
      const asset = await uploadAsset(file);
      setReferenceAssetId(asset.id);
      setReferenceImageUrl(asset.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '参考图上传失败');
    } finally {
      setBusy(null);
    }
  };

  const handleSetCurrent = async (row: ResourceImage) => {
    if (!row.assetId) return;
    setBusy(`current-${row.id}`);
    setError(null);
    try {
      await updateResourceImage(row.id, { setAsCurrent: true });
      if (target) await refreshHistory(target.kind, target.entityId);
      await reloadCurrentResources();
    } catch (e) {
      setError(e instanceof Error ? e.message : '设置当前图片失败');
    } finally {
      setBusy(null);
    }
  };

  const currentImage = target?.image || history.find((h) => h.image)?.image || '';
  const hasPendingImage = history.some((row) => row.status === 'QUEUED' || row.status === 'RUNNING');
  const workflowStage: WorkflowStage = (() => {
    if (!target) {
      if (mode === 'characters' && selectedCharacter) {
        return selectedCharacter.reviewStatus === 'CONFIRMED' ? 'needs-prompt' : 'needs-review';
      }
      return 'needs-review';
    }
    if (target.reviewStatus !== 'CONFIRMED') return 'needs-review';
    if (currentImage && !hasPendingImage) return 'refine';
    if (target.promptStatus === 'QUEUED' || target.promptStatus === 'RUNNING') return 'prompt-running';
    if (target.promptStatus === 'FAILED') return 'prompt-failed';
    if (!composeThreeViewPrompt(threeView, promptBody).trim()) return 'needs-prompt';
    if (hasPendingImage) return 'image-running';
    if (!currentImage) return 'needs-image';
    return 'refine';
  })();
  const isWorking =
    busy === 'generate' ||
    busy === 'bulk-generate' ||
    busy === 'bulk-prompt' ||
    busy === 'bulk-confirm' ||
    busy === 'generate-prompt' ||
    busy === 'confirm-resource' ||
    busy === 'upload' ||
    busy === 'reference';
  const hasPrompt = composeThreeViewPrompt(threeView, promptBody).trim().length > 0;
  const recordsNeedAttention = history.some((row) =>
    row.status === 'QUEUED' || row.status === 'RUNNING' || row.status === 'FAILED',
  );
  const resourceTitle =
    mode === 'characters'
      ? selectedCharacter?.name ?? '未选择人物'
      : target?.title ?? (mode === 'scenes' ? '未选择场景' : '未选择道具');
  const resourceDescription = descriptionDraft || '暂无描述';

  return (
    <div className="relative h-full flex flex-col bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-[var(--color-border)] bg-gray-50 p-1">
          {MODES.map(({ value, label, icon: Icon }) => {
            const active = mode === value;
            return (
              <button
                key={value}
                onClick={() => {
                  setMode(value);
                  setBulkMenuOpen(false);
                }}
                className={`h-8 px-3 rounded-md text-sm inline-flex items-center gap-1.5 transition-colors ${
                  active
                    ? 'bg-white text-[var(--color-primary)] shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          {error && (
            <div className="text-sm text-red-600 inline-flex items-center gap-2">
              {error}
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="relative">
            <button
              onClick={() => setBulkMenuOpen((open) => !open)}
              disabled={busy !== null}
              className="h-8 px-3 rounded-md border border-[var(--color-border)] text-xs inline-flex items-center gap-1.5 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy?.startsWith('bulk-') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              批量操作
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {bulkMenuOpen && (
              <div className="absolute right-0 top-9 z-30 w-56 rounded-lg border border-[var(--color-border)] bg-white shadow-lg p-1">
                <BatchAction
                  label="确认全部待确认"
                  count={batchCounts.needsReview}
                  disabled={busy !== null || batchCounts.needsReview === 0}
                  onClick={() => void handleConfirmAll()}
                />
                <BatchAction
                  label="生成已确认素材提示词"
                  count={batchCounts.needsPrompt}
                  disabled={busy !== null || batchCounts.needsPrompt === 0}
                  onClick={() => void handleGeneratePrompts()}
                />
                <BatchAction
                  label="生成缺失图片"
                  count={batchCounts.needsImage}
                  disabled={busy !== null || batchCounts.needsImage === 0}
                  onClick={() => void handleGenerateMissingImages()}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 grid grid-cols-[280px_minmax(760px,1fr)] overflow-auto">
        <ResourceList
          mode={mode}
          characters={characters}
          scenes={scenes}
          items={items}
          selectedCharacterId={selectedCharacter?.id ?? null}
          selectedSceneId={selectedScene?.id ?? null}
          selectedItemId={selectedItem?.id ?? null}
          currentStage={workflowStage}
          busy={busy}
          onSelectCharacter={setSelectedCharacterId}
          onSelectScene={setSelectedSceneId}
          onSelectItem={setSelectedItemId}
          onAdd={() => setAddMode(mode)}
          onDelete={handleDeleteResource}
        />

        <div className="min-w-0 grid grid-cols-[76px_minmax(0,1fr)] h-full bg-[var(--color-bg)]">
          <aside className="border-r border-[var(--color-border)] bg-white px-2 py-3 flex flex-col overflow-hidden">
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {historyLoading ? (
                <div className="h-12 rounded-lg bg-gray-100 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                </div>
              ) : (
                history.map((row) => (
                  <button
                    key={row.id}
                    onClick={() => {
                      if (row.assetId) {
                        void handleSetCurrent(row);
                        return;
                      }
                      if (row.status === 'FAILED') setDrawer('records');
                    }}
                    disabled={(!row.assetId && row.status !== 'FAILED') || busy === `current-${row.id}`}
                    className={`relative w-full aspect-square rounded-lg overflow-hidden border transition-colors ${
                      row.assetId === target?.assetId
                        ? 'border-[var(--color-primary)]'
                        : row.status === 'FAILED'
                          ? 'border-red-200 hover:border-red-400'
                          : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'
                    }`}
                    title={row.status === 'FAILED' ? '查看失败记录' : row.status}
                  >
                    {row.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.image} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                        {row.status === 'QUEUED' || row.status === 'RUNNING' ? (
                          <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                        ) : (
                          <ImageIcon className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                    )}
                    {row.assetId === target?.assetId && (
                      <span className="absolute right-1 top-1 w-4 h-4 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                    {row.status === 'FAILED' && (
                      <span className="absolute right-1 top-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center">
                        <X className="w-3 h-3" />
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
            <button
              onClick={() => uploadRef.current?.click()}
              disabled={!target || target.reviewStatus !== 'CONFIRMED' || isWorking}
              className="mt-3 w-full h-12 shrink-0 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:text-[var(--color-primary)] hover:border-[var(--color-primary)] disabled:opacity-50"
              title="上传图片"
            >
              {busy === 'upload' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            </button>
          </aside>

          <main className="min-w-0 flex flex-col">
            {mode === 'characters' && selectedCharacter && !selectedStyle?.id ? (
              selectedCharacter.reviewStatus !== 'CONFIRMED' ? (
                <ReviewPanel
                  title={resourceNameDraft || selectedCharacter.name}
                  nameLabel="人物名称"
                  name={resourceNameDraft}
                  description={descriptionDraft}
                  busy={busy === 'confirm-resource'}
                  onNameChange={setResourceNameDraft}
                  onDescriptionChange={setDescriptionDraft}
                  onConfirm={handleConfirmResource}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
                  <div className="w-24 h-24 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400">
                    <User className="w-9 h-9" />
                  </div>
                  <div>
                    <div className="font-semibold">{selectedCharacter.name}</div>
                    <div className="text-sm text-[var(--color-text-secondary)] mt-1">暂无造型</div>
                  </div>
                  <button
                    onClick={handleCreateDefaultStyle}
                    disabled={busy === 'create-style'}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
                  >
                    {busy === 'create-style' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    创建默认造型
                  </button>
                </div>
              )
            ) : target ? (
              <>
                <div className="border-b border-[var(--color-border)] bg-white px-5 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm truncate">{resourceTitle}</h3>
                      <StatusBadge stage={workflowStage} />
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--color-text-secondary)] truncate">
                      {resourceDescription}
                    </div>
                    {mode === 'characters' && selectedCharacter && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-[var(--color-text-secondary)]">造型</span>
                        <select
                          value={selectedStyle?.id ?? ''}
                          onChange={(e) => setSelectedStyleId(e.target.value)}
                          className="h-8 max-w-[180px] px-2 rounded-md border border-[var(--color-border)] bg-white text-xs"
                        >
                          {selectedCharacter.styles
                            .filter((s) => Boolean(s.id))
                            .map((style) => (
                              <option key={style.id} value={style.id}>
                                {style.name}
                              </option>
                            ))}
                        </select>
                        <button
                          onClick={handleCreateDefaultStyle}
                          disabled={busy === 'create-style'}
                          className="h-8 px-2.5 rounded-md border border-[var(--color-border)] inline-flex items-center gap-1 text-xs text-gray-600 hover:text-[var(--color-primary)] disabled:opacity-50"
                          title="新建造型"
                        >
                          {busy === 'create-style' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                          新建造型
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      onClick={() => setDrawer('info')}
                      className="h-8 px-3 rounded-md border border-[var(--color-border)] text-xs inline-flex items-center gap-1.5 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                    >
                      <PencilLine className="w-3.5 h-3.5" />
                      编辑信息
                    </button>
                    <button
                      onClick={() => setDrawer('records')}
                      className={`h-8 px-3 rounded-md border text-xs inline-flex items-center gap-1.5 ${
                        recordsNeedAttention
                          ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary)]/5'
                          : 'border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
                      }`}
                    >
                      <History className="w-3.5 h-3.5" />
                      生成记录
                      {history.length > 0 && (
                        <span className="ml-0.5 min-w-4 h-4 px-1 rounded-full bg-gray-100 text-[10px] leading-4 text-gray-500">
                          {history.length}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 flex items-center justify-center p-5">
                  <div
                    className="w-full h-full max-h-[58vh] rounded-lg border border-[var(--color-border)] bg-white flex items-center justify-center overflow-hidden"
                  >
                    {workflowStage === 'needs-review' ? (
                      <ReviewPanel
                        title={resourceTitle}
                        nameLabel={mode === 'characters' ? '人物名称' : mode === 'scenes' ? '场景名称' : '道具名称'}
                        name={resourceNameDraft}
                        description={descriptionDraft}
                        busy={busy === 'confirm-resource'}
                        onNameChange={setResourceNameDraft}
                        onDescriptionChange={setDescriptionDraft}
                        onConfirm={handleConfirmResource}
                        compact
                      />
                    ) : workflowStage === 'needs-prompt' || workflowStage === 'prompt-failed' ? (
                      <PromptStatePanel
                        failed={workflowStage === 'prompt-failed'}
                        error={target.promptError}
                        busy={busy === 'generate-prompt'}
                        onGenerate={handleGeneratePrompt}
                      />
                    ) : workflowStage === 'prompt-running' ? (
                      <div className="flex flex-col items-center gap-3 text-sm text-[var(--color-text-secondary)]">
                        <Loader2 className="w-7 h-7 animate-spin text-[var(--color-primary)]" />
                        提示词生成中
                      </div>
                    ) : currentImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={currentImage}
                        alt={target.title}
                        className="max-w-full max-h-full object-contain cursor-pointer"
                        onClick={() => setPreviewOpen(true)}
                      />
                    ) : (
                      <button
                        onClick={() => uploadRef.current?.click()}
                        className="w-full h-full flex flex-col items-center justify-center text-gray-400 hover:bg-gray-50"
                      >
                        <ImagePlus className="w-10 h-10" />
                      </button>
                    )}
                  </div>
                </div>

                {(workflowStage === 'needs-image' || workflowStage === 'image-running' || workflowStage === 'refine') && (
                <div className="border-t border-[var(--color-border)] bg-white px-5 py-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => referenceRef.current?.click()}
                      disabled={isWorking}
                      className="h-10 px-3 rounded-lg border border-[var(--color-border)] text-sm inline-flex items-center gap-1.5 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
                    >
                      <Upload className="w-4 h-4" />
                      参考图
                    </button>
                    <button
                      onClick={buildAutoPrompt}
                      className="h-10 px-3 rounded-lg border border-[var(--color-border)] text-sm inline-flex items-center gap-1.5 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                    >
                      <Wand2 className="w-4 h-4" />
                      {mode === 'characters' ? '三视图' : '自动填充'}
                    </button>
                  </div>

                  {referenceImageUrl && (
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={referenceImageUrl} alt="参考图" className="w-12 h-12 object-cover rounded-lg border border-[var(--color-border)]" />
                        <button
                          onClick={() => {
                            setReferenceAssetId(null);
                            setReferenceImageUrl('');
                          }}
                          className="absolute -right-1.5 -top-1.5 w-5 h-5 rounded-full bg-gray-700 text-white flex items-center justify-center"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-[var(--color-border)] bg-white overflow-hidden focus-within:border-[var(--color-primary)] focus-within:ring-1 focus-within:ring-[var(--color-primary)]">
                    {threeView && (
                      <div className="px-3 pt-2">
                        <span className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-xs font-medium">
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
                      rows={3}
                      value={promptBody}
                      onChange={(e) => setPromptBody(e.target.value)}
                      onBlur={() => void persistMetadata()}
                      placeholder="提示词"
                      className="w-full px-3 py-2 outline-none text-sm resize-none font-mono leading-relaxed bg-transparent"
                    />
                    <div className="border-t border-[var(--color-border)] px-3 py-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                          模型
                          <select
                            value={modelDraft}
                            onChange={(e) => setModelDraft(e.target.value)}
                            onBlur={() => void persistMetadata()}
                            className="h-9 min-w-[132px] px-2 rounded-lg border border-[var(--color-border)] bg-white text-sm text-[var(--color-text)]"
                          >
                            {IMAGE_MODEL_OPTIONS.map((o) => (
                              <option key={o.modelId} value={o.modelId}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                          比例
                          <select
                            value={ratioDraft}
                            onChange={(e) => setRatioDraft(e.target.value)}
                            onBlur={() => void persistMetadata()}
                            className="h-9 min-w-[108px] px-2 rounded-lg border border-[var(--color-border)] bg-white text-sm text-[var(--color-text)]"
                          >
                            {RATIO_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <button
                        onClick={handleGenerate}
                        disabled={busy === 'generate' || busy === 'bulk-generate' || workflowStage === 'image-running' || !hasPrompt}
                        title={!hasPrompt ? '请先填写提示词或点击「三视图」' : undefined}
                        className="h-9 w-full sm:w-auto px-4 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium inline-flex items-center justify-center gap-2 hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busy === 'generate' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {currentImage ? '重新生成' : '生成图片'}
                      </button>
                    </div>
                  </div>
                </div>
                )}
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
                暂无内容
              </div>
            )}
          </main>

        </div>
      </div>

      {drawer && (
        <div className="absolute inset-0 z-20 flex justify-end bg-black/10">
          <button
            type="button"
            aria-label="关闭抽屉"
            onClick={() => setDrawer(null)}
            className="absolute inset-0 cursor-default"
          />
          <aside className="relative z-10 h-full w-[380px] max-w-[calc(100vw-32px)] bg-white border-l border-[var(--color-border)] shadow-xl flex flex-col">
            <div className="h-14 px-4 border-b border-[var(--color-border)] flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">
                  {drawer === 'info' ? '编辑信息' : '生成记录'}
                </div>
                <div className="text-xs text-[var(--color-text-secondary)] truncate max-w-[280px]">
                  {resourceTitle}
                </div>
              </div>
              <button
                onClick={() => setDrawer(null)}
                className="w-8 h-8 rounded-md flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {drawer === 'info' ? (
              <div className="p-4 space-y-3 overflow-y-auto">
                {mode === 'characters' ? (
                  <>
                    <Field label="人物名称" value={resourceNameDraft} onChange={setResourceNameDraft} onBlur={persistMetadata} />
                    <Field label="造型名称" value={styleNameDraft} onChange={setStyleNameDraft} onBlur={persistMetadata} />
                  </>
                ) : (
                  <Field label="名称" value={resourceNameDraft} onChange={setResourceNameDraft} onBlur={persistMetadata} />
                )}
                <Field
                  label="描述"
                  value={descriptionDraft}
                  onChange={setDescriptionDraft}
                  onBlur={persistMetadata}
                  multiline
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
                {history.length === 0 ? (
                  <div className="h-40 rounded-lg border border-dashed border-[var(--color-border)] flex flex-col items-center justify-center text-xs text-gray-400">
                    <History className="w-5 h-5 mb-2" />
                    暂无生成记录
                  </div>
                ) : (
                  history.map((row) => (
                    <QueueCard
                      key={row.id}
                      row={row}
                      currentAssetId={target?.assetId ?? null}
                      busy={busy}
                      onSetCurrent={handleSetCurrent}
                      onRetry={(r) =>
                        runGenerate(
                          r.prompt || composeThreeViewPrompt(threeView, promptBody),
                          r.model || modelDraft || project.imageModel,
                          r.ratio || ratioDraft || project.ratio,
                        )
                      }
                    />
                  ))
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleUpload(f);
          e.target.value = '';
        }}
      />
      <input
        ref={referenceRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleUploadReference(f);
          e.target.value = '';
        }}
      />
      <ImagePreview
        src={currentImage}
        alt={target?.title ?? ''}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
      <AddResourceModal
        mode={addMode}
        onClose={() => setAddMode(null)}
        onCreate={handleAddResource}
      />
    </div>
  );
}

function ResourceList({
  mode,
  characters,
  scenes,
  items,
  selectedCharacterId,
  selectedSceneId,
  selectedItemId,
  currentStage,
  busy,
  onSelectCharacter,
  onSelectScene,
  onSelectItem,
  onAdd,
  onDelete,
}: {
  mode: ResourceMode;
  characters: Character[];
  scenes: Scene[];
  items: Item[];
  selectedCharacterId: string | null;
  selectedSceneId: string | null;
  selectedItemId: string | null;
  currentStage: WorkflowStage;
  busy: string | null;
  onSelectCharacter: (id: string) => void;
  onSelectScene: (id: string) => void;
  onSelectItem: (id: string) => void;
  onAdd: () => void;
  onDelete: (mode: ResourceMode, id: string) => void;
}) {
  return (
    <aside className="scrollbar-none border-r border-[var(--color-border)] bg-white overflow-y-auto">
      <div className="p-3 space-y-2">
        {mode === 'characters' &&
          characters.map((char) => (
            <ListRow
              key={char.id}
              icon={<User className="w-7 h-7 text-gray-400" />}
              image={char.avatar}
              title={char.name}
              subtitle={char.description || '暂无描述'}
              active={selectedCharacterId === char.id}
              badgeStage={selectedCharacterId === char.id ? currentStage : stageForCharacter(char)}
              busy={busy === `delete-${char.id}`}
              onClick={() => onSelectCharacter(char.id)}
              onDelete={() => onDelete('characters', char.id)}
            />
          ))}
        {mode === 'scenes' &&
          scenes.map((scene) => (
            <ListRow
              key={scene.id}
              icon={<ImageIcon className="w-7 h-7 text-gray-400" />}
              image={scene.image}
              title={scene.name}
              subtitle={scene.description || '暂无描述'}
              active={selectedSceneId === scene.id}
              badgeStage={selectedSceneId === scene.id ? currentStage : stageForImageResource(scene)}
              busy={busy === `delete-${scene.id}`}
              onClick={() => onSelectScene(scene.id)}
              onDelete={() => onDelete('scenes', scene.id)}
            />
          ))}
        {mode === 'items' &&
          items.map((item) => (
            <ListRow
              key={item.id}
              icon={<Package className="w-7 h-7 text-gray-400" />}
              image={item.image}
              title={item.name}
              subtitle={item.description || '暂无描述'}
              active={selectedItemId === item.id}
              badgeStage={selectedItemId === item.id ? currentStage : stageForImageResource(item)}
              busy={busy === `delete-${item.id}`}
              onClick={() => onSelectItem(item.id)}
              onDelete={() => onDelete('items', item.id)}
            />
          ))}
        <button
          onClick={onAdd}
          className="w-full flex flex-col items-center justify-center gap-1 p-3 rounded-lg border border-dashed border-gray-300 text-gray-500 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span className="text-sm">
            {mode === 'characters' ? '添加人物' : mode === 'scenes' ? '添加场景' : '添加道具'}
          </span>
        </button>
      </div>
    </aside>
  );
}

function StatusBadge({
  stage,
  compact,
}: {
  stage: WorkflowStage;
  compact?: boolean;
}) {
  return (
    <span
      className={`shrink-0 inline-flex items-center rounded-full border ${stageClassName(stage)} ${
        compact ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-[11px]'
      }`}
    >
      {stageLabel(stage)}
    </span>
  );
}

function BatchAction({
  label,
  count,
  disabled,
  onClick,
}: {
  label: string;
  count: number;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full h-9 px-2 rounded-md text-left text-xs flex items-center justify-between gap-2 hover:bg-gray-50 disabled:opacity-45 disabled:cursor-not-allowed"
    >
      <span>{label}</span>
      <span className="min-w-5 h-5 px-1 rounded-full bg-gray-100 text-[11px] leading-5 text-gray-500 text-center">
        {count}
      </span>
    </button>
  );
}

function ReviewPanel({
  title,
  nameLabel,
  name,
  description,
  busy,
  compact,
  onNameChange,
  onDescriptionChange,
  onConfirm,
}: {
  title: string;
  nameLabel: string;
  name: string;
  description: string;
  busy: boolean;
  compact?: boolean;
  onNameChange: (next: string) => void;
  onDescriptionChange: (next: string) => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <div className={`w-full ${compact ? 'max-w-md p-5' : 'max-w-lg p-6'} text-left`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <AlertCircle className="w-4 h-4 text-amber-600" />
        {title}
      </div>
      <div className="mt-4 space-y-3">
        <Field label={nameLabel} value={name} onChange={onNameChange} onBlur={() => undefined} />
        <Field
          label="描述"
          value={description}
          onChange={onDescriptionChange}
          onBlur={() => undefined}
          multiline
        />
      </div>
      <button
        onClick={() => void onConfirm()}
        disabled={busy || !name.trim()}
        className="mt-4 h-9 px-4 rounded-lg bg-[var(--color-primary)] text-white text-sm inline-flex items-center justify-center gap-2 hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        确认素材
      </button>
    </div>
  );
}

function PromptStatePanel({
  failed,
  error,
  busy,
  onGenerate,
}: {
  failed: boolean;
  error?: string | null;
  busy: boolean;
  onGenerate: () => void | Promise<void>;
}) {
  return (
    <div className="w-full max-w-md p-6 text-center">
      <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center ${failed ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-[var(--color-primary)]'}`}>
        {failed ? <AlertCircle className="w-6 h-6" /> : <Wand2 className="w-6 h-6" />}
      </div>
      <div className="mt-3 text-sm font-semibold">
        {failed ? '提示词生成失败' : '待生成提示词'}
      </div>
      {failed && error && (
        <div className="mt-2 text-xs text-red-600 line-clamp-3">{error}</div>
      )}
      <button
        onClick={() => void onGenerate()}
        disabled={busy}
        className="mt-4 h-9 px-4 rounded-lg bg-[var(--color-primary)] text-white text-sm inline-flex items-center justify-center gap-2 hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {failed ? '重新生成提示词' : '生成提示词'}
      </button>
    </div>
  );
}

function ListRow({
  icon,
  image,
  title,
  subtitle,
  active,
  badgeStage,
  busy,
  onClick,
  onDelete,
}: {
  icon: React.ReactNode;
  image?: string;
  title: string;
  subtitle: string;
  active: boolean;
  badgeStage: WorkflowStage;
  busy: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="relative group pr-3 overflow-visible">
      <button
        onClick={onClick}
        className={`relative w-full min-h-[112px] grid grid-cols-[76px_minmax(0,1fr)] gap-3 p-3 rounded-lg text-left transition-colors border ${
          active
            ? 'bg-blue-50 border-[var(--color-primary)]'
            : 'hover:bg-gray-50 border-transparent'
        }`}
      >
        <span className="absolute right-2 top-2">
          <StatusBadge stage={badgeStage} compact />
        </span>
        <div className="h-full min-h-[88px] rounded-md bg-gray-100 flex items-center justify-center overflow-hidden">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={title} className="w-full h-full object-cover" />
          ) : (
            icon
          )}
        </div>
        <div className="min-w-0 flex flex-col gap-2">
          <div className="pr-16 font-medium text-sm truncate">{title}</div>
          <div className="text-xs text-[var(--color-text-secondary)] line-clamp-3 leading-relaxed">
            {subtitle}
          </div>
        </div>
      </button>
      <button
        onClick={onDelete}
        disabled={busy}
        className="absolute top-0 right-3 w-6 h-6 translate-x-1/2 -translate-y-1/2 rounded-full bg-white/95 text-gray-400 shadow-sm ring-1 ring-gray-200 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center disabled:opacity-50"
        title="删除"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void | Promise<void>;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-[var(--color-text-secondary)]">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => void onBlur()}
          rows={4}
          className="mt-1 w-full px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-white text-sm resize-none outline-none focus:border-[var(--color-primary)]"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => void onBlur()}
          className="mt-1 w-full px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-white text-sm outline-none focus:border-[var(--color-primary)]"
        />
      )}
    </div>
  );
}

function QueueCard({
  row,
  currentAssetId,
  busy,
  onSetCurrent,
  onRetry,
}: {
  row: ResourceImage;
  currentAssetId: string | null;
  busy: string | null;
  onSetCurrent: (row: ResourceImage) => void;
  onRetry: (row: ResourceImage) => void;
}) {
  const active = row.assetId && row.assetId === currentAssetId;
  const pending = row.status === 'QUEUED' || row.status === 'RUNNING';
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-white p-2">
      <div className="flex gap-2">
        <div className="w-14 h-14 rounded-md bg-gray-100 overflow-hidden flex-shrink-0 relative">
          {row.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.image} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {pending ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : <ImageIcon className="w-4 h-4 text-gray-400" />}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[11px] px-1.5 py-0.5 rounded ${
              row.status === 'SUCCEEDED'
                ? 'bg-green-50 text-green-700'
                : row.status === 'FAILED'
                  ? 'bg-red-50 text-red-700'
                  : 'bg-blue-50 text-blue-700'
            }`}>
              {row.status === 'SUCCEEDED'
                ? '完成'
                : row.status === 'FAILED'
                  ? '失败'
                  : row.status === 'CANCELLED'
                    ? '已取消'
                    : row.status === 'RUNNING'
                      ? '生成中'
                      : '排队中'}
            </span>
            {active && <span className="text-[11px] text-[var(--color-primary)]">当前</span>}
          </div>
          <div className="mt-1 text-xs text-[var(--color-text-secondary)] line-clamp-2">
            {row.prompt || (row.source === 'upload' ? '本地上传' : '无提示词')}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1 text-[11px] text-gray-400">
        {row.model && <span className="truncate">{row.model}</span>}
        {row.ratio && <span>{row.ratio}</span>}
      </div>
      {row.error && <div className="mt-1 text-xs text-red-600 line-clamp-2">{row.error}</div>}
      <div className="mt-2 flex justify-end gap-1">
        {row.assetId && !active && (
          <button
            onClick={() => onSetCurrent(row)}
            disabled={busy === `current-${row.id}`}
            className="px-2 py-1 rounded-md border border-[var(--color-border)] text-xs hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
          >
            设为当前
          </button>
        )}
        {(row.status === 'FAILED' || row.status === 'SUCCEEDED') && (
          <button
            onClick={() => onRetry(row)}
            disabled={busy === 'generate'}
            className="px-2 py-1 rounded-md border border-[var(--color-border)] text-xs inline-flex items-center gap-1 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
          >
            <RefreshCcw className="w-3 h-3" />
            重试
          </button>
        )}
      </div>
    </div>
  );
}

function AddResourceModal({
  mode,
  onClose,
  onCreate,
}: {
  mode: ResourceMode | null;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mode) {
      setName('');
      setBusy(false);
      setError(null);
    }
  }, [mode]);

  if (!mode) return null;
  const label = mode === 'characters' ? '人物' : mode === 'scenes' ? '场景' : '道具';

  const handleConfirm = async () => {
    if (!name.trim()) {
      setError(`请输入${label}名称`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-[420px] max-w-[92vw] rounded-lg bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">添加{label}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleConfirm();
          }}
          placeholder={`${label}名称`}
          className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] outline-none focus:border-[var(--color-primary)] text-sm"
        />
        {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-[var(--color-border)] text-sm hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy || !name.trim()}
            className="px-4 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-primary-hover)] disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
