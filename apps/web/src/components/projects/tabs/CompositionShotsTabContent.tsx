'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Grid3X3,
  Image as ImageIcon,
  ImagePlus,
  Layers3,
  Loader2,
  Plus,
  RefreshCcw,
  Send,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  Character,
  CompositionCandidate,
  CompositionGridRun,
  CompositionImageRun,
  CompositionTask,
  CompositionTaskRuns,
  Item,
  Project,
  ProjectTab,
  Scene,
  StoryboardEpisode,
} from '@/types';
import {
  ApplyCompositionMode,
  analyzeCompositionTasks,
  applyCompositionGridToShots,
  generateCompositionGrid,
  generateCompositionImage,
  getCompositionTaskRuns,
  getCompositionTasks,
  setCurrentCompositionGridRun,
  setCurrentCompositionImageRun,
  updateCharacterStyle,
  updateCompositionTask,
  updateItem,
  updateScene,
  type CompositionImageGenerationSettings,
} from '@/lib/api';
import { IMAGE_MODEL_OPTIONS, imageModelLabel } from '@/data/style-presets';
import { EntityDetailDrawer, type EntityDetailData } from '@/components/projects/EntityDetailDrawer';
import { useGeneration, type GenerationKind } from '@/contexts/GenerationContext';
import { buildResourceImagePrompt } from '@oneness/shared/resource-prompts';
import { CompositionCanvasView } from './CompositionCanvasView';

interface Props {
  project: Project;
  episodes: StoryboardEpisode[];
  characters: Character[];
  scenes: Scene[];
  items: Item[];
  onOpenTab?: (tab: ProjectTab) => void;
  onRefreshReferences?: () => Promise<void>;
}

type FilterValue = 'all' | 'draft' | 'running' | 'image' | 'grid' | 'applied' | 'failed';
type DetailView = 'current' | 'history';
type ResultView = 'image' | 'grid';
type CompositionViewMode = 'panel' | 'canvas';
type ReferenceKind = 'characters' | 'scenes' | 'items';
type ReferenceDialogView = 'selected' | ReferenceKind;
type HistoryPreview =
  | { type: 'image'; run: CompositionImageRun }
  | { type: 'grid'; run: CompositionGridRun }
  | null;

type ImageSettings = {
  model: string;
  ratio: string;
  quality: '1080p' | '2k' | '4k';
  outputCount: number;
  negativePrompt: string;
};

type ReferenceBaseOption = {
  id: string;
  label: string;
  image: string;
};

type CharacterReferenceOption = ReferenceBaseOption & {
  assetId: string | null;
  characterId: string;
  characterName: string;
  characterDescription: string;
  characterBio: string;
  styleName: string;
  prompt: string;
  model: string | null;
  ratio: string | null;
};

type SceneReferenceOption = ReferenceBaseOption & {
  assetId: string | null;
  name: string;
  description: string;
  prompt: string;
  model: string | null;
  ratio: string | null;
};

type ItemReferenceOption = ReferenceBaseOption & {
  assetId: string | null;
  name: string;
  description: string;
  prompt: string;
  model: string | null;
  ratio: string | null;
};

type EditableReferenceOption =
  | CharacterReferenceOption
  | SceneReferenceOption
  | ItemReferenceOption;

const FILTERS: Array<{ value: FilterValue; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'draft', label: '待生成' },
  { value: 'running', label: '生成中' },
  { value: 'image', label: '有镜头图' },
  { value: 'grid', label: '有候选' },
  { value: 'applied', label: '已应用' },
  { value: 'failed', label: '失败' },
];

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const QUALITY_OPTIONS: Array<{ value: ImageSettings['quality']; label: string }> = [
  { value: '1080p', label: '1080p' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
];
const IMAGE_RUNNING_TASK_STATUSES = new Set(['IMAGE_QUEUED', 'IMAGE_RUNNING']);
const RUNNING_TASK_STATUSES = new Set(['IMAGE_QUEUED', 'IMAGE_RUNNING', 'GRID_QUEUED', 'GRID_RUNNING']);
const RUNNING_RUN_STATUSES = new Set(['QUEUED', 'RUNNING']);

function defaultImageSettings(project: Project): ImageSettings {
  return {
    model: project.imageModel,
    ratio: project.ratio,
    quality: '1080p',
    outputCount: 1,
    negativePrompt: '',
  };
}

function getCompositionGate(
  project: Project,
  episodes: StoryboardEpisode[],
  scenes: Scene[],
): {
  ready: boolean;
  title: string;
  description: string;
  actionLabel: string;
  tab?: ProjectTab;
} {
  if (episodes.length === 0) {
    return {
      ready: false,
      title: '还没有剧本',
      description: '先上传剧本并解析素材，再进入合成镜头任务。',
      actionLabel: '上传剧本',
      tab: 'info',
    };
  }
  if (project.analysisState !== 'completed') {
    const running = project.analysisState === 'running';
    const failed = project.analysisState === 'failed';
    return {
      ready: false,
      title: running ? '剧本正在解析' : failed ? '剧本解析失败' : '剧本尚未解析',
      description: running
        ? '剧本解析完成后，角色、场景和道具引用会用于合成镜头任务。'
        : '先完成角色、场景和道具素材解析，再生成合成镜头任务。',
      actionLabel: running ? '查看解析状态' : failed ? '重新解析剧本' : '开始解析剧本',
      tab: 'info',
    };
  }
  if (scenes.length === 0) {
    return {
      ready: false,
      title: '还没有场景素材',
      description: '先在场景页生成或选择场景素材，合成镜头会基于角色、道具和场景素材创建。',
      actionLabel: '进入场景页',
      tab: 'scenes',
    };
  }
  return {
    ready: true,
    title: '可以生成合成镜头任务',
    description:
      '系统会读取已解析的角色、场景和道具素材，按场景素材预填引用并创建合成镜头任务。首版只创建任务，不会自动生成图片。',
    actionLabel: '生成合成镜头任务',
  };
}

export function CompositionShotsTabContent({
  project,
  episodes,
  characters,
  scenes,
  items,
  onOpenTab,
  onRefreshReferences,
}: Props) {
  const router = useRouter();
  const [tasks, setTasks] = useState<CompositionTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>('all');
  const [detailView, setDetailView] = useState<DetailView>('current');
  const [resultView, setResultView] = useState<ResultView>('image');
  const [runsByTask, setRunsByTask] = useState<Record<string, CompositionTaskRuns>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [imageSettingsByTask, setImageSettingsByTask] = useState<Record<string, ImageSettings>>({});
  const [referenceDialog, setReferenceDialog] = useState<ReferenceDialogView | null>(null);
  const [candidateRunId, setCandidateRunId] = useState<string | null>(null);
  const [historyPreview, setHistoryPreview] = useState<HistoryPreview>(null);
  const [showApplyPanel, setShowApplyPanel] = useState(false);
  const [applyMode, setApplyMode] = useState<ApplyCompositionMode>('create_shots');
  const [viewMode, setViewMode] = useState<CompositionViewMode>('panel');

  const characterOptions = useMemo(
    () =>
      characters.flatMap((character) =>
        character.styles.map((style) => ({
          id: style.id ?? '',
          label: `${character.name} · ${style.name}`,
          image: style.image,
          assetId: style.assetId ?? null,
          characterId: character.id,
          characterName: character.name,
          characterDescription: character.description,
          characterBio: character.bio,
          styleName: style.name,
          prompt: style.prompt ?? '',
          model: style.model ?? null,
          ratio: style.ratio ?? null,
        })),
      ).filter((option) => option.id),
    [characters],
  );
  const sceneOptions = useMemo(
    () => scenes.map((scene) => ({
      id: scene.id,
      label: scene.name,
      image: scene.image,
      assetId: scene.assetId ?? null,
      name: scene.name,
      description: scene.description ?? '',
      prompt: scene.prompt ?? '',
      model: scene.model ?? null,
      ratio: scene.ratio ?? null,
    })),
    [scenes],
  );
  const itemOptions = useMemo(
    () => items.map((item) => ({
      id: item.id,
      label: item.name,
      image: item.image,
      assetId: item.assetId ?? null,
      name: item.name,
      description: item.description ?? '',
      prompt: item.prompt ?? '',
      model: item.model ?? null,
      ratio: item.ratio ?? null,
    })),
    [items],
  );

  const selectedTask = tasks.find((task) => task.id === selectedId) ?? tasks[0] ?? null;
  const selectedTaskId = selectedTask?.id ?? null;
  const runs = selectedTask ? runsByTask[selectedTask.id] : null;
  const currentImageRun =
    selectedTask && runs
      ? runs.imageRuns.find((run) => run.id === selectedTask.currentImageRunId) ?? runs.imageRuns[0] ?? null
      : null;
  const currentGridRun =
    selectedTask && runs
      ? runs.gridRuns.find((run) => run.id === selectedTask.currentGridRunId) ?? runs.gridRuns[0] ?? null
      : null;
  const candidateDialogRun =
    runs?.gridRuns.find((run) => run.id === candidateRunId) ??
    (currentGridRun?.id === candidateRunId ? currentGridRun : null);
  const promptDraft = selectedTask ? (promptDrafts[selectedTask.id] ?? selectedTask.prompt) : '';
  const imageSettings = selectedTask
    ? imageSettingsByTask[selectedTask.id] ?? defaultImageSettings(project)
    : defaultImageSettings(project);
  const compositionGate = useMemo(
    () => getCompositionGate(project, episodes, scenes),
    [project, episodes, scenes],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(`oneness:composition-view-mode:${project.id}`);
    if (stored !== 'panel' && stored !== 'canvas') return;
    const frame = window.requestAnimationFrame(() => setViewMode(stored));
    return () => window.cancelAnimationFrame(frame);
  }, [project.id]);

  const handleViewModeChange = useCallback((mode: CompositionViewMode) => {
    setViewMode(mode);
    window.localStorage.setItem(`oneness:composition-view-mode:${project.id}`, mode);
  }, [project.id]);

  const reloadTasks = useCallback(async () => {
    const fresh = await getCompositionTasks(project.id);
    setTasks(fresh);
    setSelectedId((current) => current ?? fresh[0]?.id ?? null);
    return fresh;
  }, [project.id]);

  const reloadRuns = useCallback(async (taskId: string) => {
    const fresh = await getCompositionTaskRuns(taskId);
    setRunsByTask((prev) => ({ ...prev, [taskId]: fresh }));
    return fresh;
  }, []);

  useEffect(() => {
    let cancelled = false;
    getCompositionTasks(project.id)
      .then((fresh) => {
        if (cancelled) return;
        setTasks(fresh);
        setSelectedId(fresh[0]?.id ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '合成任务加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    if (!selectedTaskId) return;
    let cancelled = false;
    getCompositionTaskRuns(selectedTaskId)
      .then((fresh) => {
        if (cancelled) return;
        setRunsByTask((prev) => ({ ...prev, [selectedTaskId]: fresh }));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '生成历史加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTaskId]);

  useEffect(() => {
    const inFlight =
      tasks.some((task) => RUNNING_TASK_STATUSES.has(task.status)) ||
      Object.values(runsByTask).some((taskRuns) =>
        taskRuns.imageRuns.some((run) => RUNNING_RUN_STATUSES.has(run.status)) ||
        taskRuns.gridRuns.some((run) => RUNNING_RUN_STATUSES.has(run.status)),
      );
    if (!inFlight) return;
    const timer = setInterval(() => {
      reloadTasks()
        .then((fresh) => {
          const activeId = selectedId ?? fresh[0]?.id;
          if (activeId) void reloadRuns(activeId).catch(() => {});
        })
        .catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, [tasks, runsByTask, reloadTasks, reloadRuns, selectedId]);

  const filteredTasks = tasks.filter((task) => {
    if (filter === 'all') return true;
    if (filter === 'draft') return task.status === 'DRAFT';
    if (filter === 'running') return RUNNING_TASK_STATUSES.has(task.status);
    if (filter === 'image') return task.status === 'IMAGE_READY';
    if (filter === 'grid') return task.status === 'GRID_READY';
    if (filter === 'applied') return task.status === 'APPLIED' || task.status === 'SYNCED';
    return task.status === 'IMAGE_FAILED' || task.status === 'GRID_FAILED';
  });

  const updateTaskInList = (next: CompositionTask) => {
    setTasks((prev) => prev.map((task) => (task.id === next.id ? next : task)));
    setSelectedId(next.id);
  };

  const handleAnalyze = async () => {
    if (!compositionGate.ready) {
      if (compositionGate.tab) onOpenTab?.(compositionGate.tab);
      return;
    }
    setBusy('analyze');
    setError(null);
    try {
      const fresh = await analyzeCompositionTasks(project.id);
      setTasks(fresh);
      setSelectedId(fresh[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成合成镜头任务失败');
    } finally {
      setBusy(null);
    }
  };

  const patchSelected = async (patch: Parameters<typeof updateCompositionTask>[1]) => {
    if (!selectedTask) return;
    setBusy(`patch-${selectedTask.id}`);
    setError(null);
    try {
      const next = await updateCompositionTask(selectedTask.id, patch);
      updateTaskInList(next);
      void reloadRuns(next.id).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(null);
    }
  };

  const savePromptIfNeeded = async () => {
    if (!selectedTask || promptDraft === selectedTask.prompt) return selectedTask;
    const next = await updateCompositionTask(selectedTask.id, { prompt: promptDraft });
    updateTaskInList(next);
    return next;
  };

  const handleGenerateImage = async () => {
    if (!selectedTask) return;
    setBusy(`image-${selectedTask.id}`);
    setError(null);
    try {
      const taskForPrompt = await savePromptIfNeeded();
      const payload: CompositionImageGenerationSettings = imageSettings;
      const next = await generateCompositionImage(taskForPrompt.id, payload);
      updateTaskInList(next);
      await reloadRuns(next.id);
      setDetailView('current');
      setResultView('image');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成合成镜头图失败');
    } finally {
      setBusy(null);
    }
  };

  const handleGenerateGrid = async (imageRunId = currentImageRun?.id) => {
    if (!selectedTask || !imageRunId) return;
    setBusy(`grid-${imageRunId}`);
    setError(null);
    try {
      const sourceRun = runs?.imageRuns.find((run) => run.id === imageRunId) ?? currentImageRun;
      const next = await generateCompositionGrid(imageRunId, {
        model: sourceRun?.model ?? project.imageModel,
        ratio: sourceRun?.ratio ?? project.ratio,
        specification: '3x3',
      });
      updateTaskInList(next);
      await reloadRuns(next.id);
      setDetailView('current');
      setResultView('grid');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成分镜网格失败');
    } finally {
      setBusy(null);
    }
  };

  const handleSetCurrentImageRun = async (runId: string) => {
    if (!selectedTask) return;
    setBusy(`current-${runId}`);
    setError(null);
    try {
      const next = await setCurrentCompositionImageRun(runId);
      updateTaskInList(next);
      await reloadRuns(next.id);
      setDetailView('current');
      setResultView('image');
    } catch (e) {
      setError(e instanceof Error ? e.message : '设置当前镜头图失败');
    } finally {
      setBusy(null);
    }
  };

  const handleSetCurrentGridRun = async (runId: string) => {
    if (!selectedTask) return;
    setBusy(`current-grid-${runId}`);
    setError(null);
    try {
      const next = await setCurrentCompositionGridRun(runId);
      updateTaskInList(next);
      await reloadRuns(next.id);
      setDetailView('current');
      setResultView('grid');
      setHistoryPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '设置当前分镜网格失败');
    } finally {
      setBusy(null);
    }
  };

  const openCandidateDialog = (run: CompositionGridRun, openApply = false) => {
    setCandidateRunId(run.id);
    setShowApplyPanel(openApply);
  };

  const closeCandidateDialog = () => {
    setCandidateRunId(null);
    setShowApplyPanel(false);
  };

  const toggleCandidate = (run: CompositionGridRun, candidate: CompositionCandidate) => {
    if (!selectedTask) return;
    const selectedIds = run.candidates
      .filter((item) => item.selected !== (item.id === candidate.id))
      .map((item) => item.id);
    void patchSelected({ selectedCandidateIds: selectedIds });
  };

  const handleApplyCandidates = async (run: CompositionGridRun) => {
    if (!selectedTask) return;
    const candidateIds = run.candidates
      .filter((candidate) => candidate.selected)
      .map((candidate) => candidate.id);
    setBusy(`apply-${run.id}`);
    setError(null);
    try {
      const next = await applyCompositionGridToShots(run.id, {
        candidateIds,
        mode: applyMode,
      });
      updateTaskInList(next);
      await reloadRuns(next.id);
      setShowApplyPanel(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '应用到分镜失败');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        加载合成镜头...
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="h-full overflow-y-auto px-6 py-8">
        <div className="min-h-[520px] border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center text-center px-6 bg-[var(--color-bg-card)]">
          <div className="w-14 h-14 rounded-full bg-[var(--color-dark)] text-white flex items-center justify-center mb-4">
            <Clapperboard className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-semibold text-[var(--color-text)] mb-2">生成合成镜头任务</h2>
          <p className="max-w-[560px] text-sm leading-6 text-[var(--color-text-secondary)] mb-5">
            {compositionGate.description}
          </p>
          <div className="flex items-center gap-3 text-xs text-gray-500 mb-6">
            <span>{episodes.length} 个剧集</span>
            <span>{characters.length} 个角色</span>
            <span>{scenes.length} 个场景素材</span>
            <span>{items.length} 个道具</span>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={busy === 'analyze' || (!compositionGate.ready && !compositionGate.tab)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
          >
            {busy === 'analyze' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {busy === 'analyze' ? '生成中...' : compositionGate.actionLabel}
          </button>
          {!compositionGate.ready && (
            <div className="text-xs text-red-500 mt-3">{compositionGate.title}</div>
          )}
          {error && <div className="text-sm text-red-600 mt-4">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--color-border)]">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">合成镜头</h2>
          <div className="text-xs text-[var(--color-text-secondary)]">
            版本化保存镜头图和分镜网格，候选图从当前网格或历史网格中按需应用
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg border border-[var(--color-border)] p-1">
            <button
              onClick={() => handleViewModeChange('panel')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm ${
                viewMode === 'panel' ? 'bg-[var(--color-dark)] text-white' : 'text-gray-600'
              }`}
            >
              <Grid3X3 className="w-4 h-4" />
              面板
            </button>
            <button
              onClick={() => handleViewModeChange('canvas')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm ${
                viewMode === 'canvas' ? 'bg-[var(--color-dark)] text-white' : 'text-gray-600'
              }`}
            >
              <Layers3 className="w-4 h-4" />
              画布
            </button>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={busy === 'analyze' || !compositionGate.ready}
            title={compositionGate.ready ? '重新生成合成镜头任务' : compositionGate.title}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] text-sm hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
          >
            {busy === 'analyze' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
            重新生成任务
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:underline">关闭</button>
        </div>
      )}

      {viewMode === 'canvas' && selectedTask ? (
        <div className="flex-1 min-h-0">
          <CompositionCanvasView
            projectId={project.id}
            tasks={tasks}
            selectedTask={selectedTask}
            runs={runs}
            characterOptions={characterOptions}
            sceneOptions={sceneOptions}
            itemOptions={itemOptions}
            promptDraft={promptDraft}
            imageSettings={imageSettings}
            busy={busy}
            onSelectTask={(taskId) => {
              setSelectedId(taskId);
              setDetailView('current');
              setResultView('image');
            }}
            onPatch={patchSelected}
            onPromptChange={(next) => setPromptDrafts((prev) => ({ ...prev, [selectedTask.id]: next }))}
            onImageSettingsChange={(next) => setImageSettingsByTask((prev) => ({
              ...prev,
              [selectedTask.id]: next,
            }))}
            onOpenReferenceDialog={(kind) => setReferenceDialog(kind)}
            onGenerateImage={handleGenerateImage}
          />
        </div>
      ) : (
      <div className="flex-1 min-h-0 grid grid-cols-[340px_minmax(0,1fr)]">
        <aside className="border-r border-[var(--color-border)] min-h-0 flex flex-col">
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((item) => (
                <button
                  key={item.value}
                  onClick={() => setFilter(item.value)}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                    filter === item.value
                      ? 'bg-[var(--color-dark)] text-white border-[var(--color-dark)]'
                      : 'border-[var(--color-border)] text-gray-600 hover:border-[var(--color-primary)]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredTasks.map((task) => (
              <TaskListItem
                key={task.id}
                task={task}
                active={selectedTask?.id === task.id}
                onClick={() => {
                  setSelectedId(task.id);
                  setDetailView('current');
                  setResultView(task.currentGridRunId ? 'grid' : 'image');
                }}
              />
            ))}
            {filteredTasks.length === 0 && (
              <div className="text-sm text-gray-400 text-center py-10">当前筛选下没有任务</div>
            )}
          </div>
        </aside>

        <main className="min-w-0 min-h-0 overflow-y-auto">
          {selectedTask && (
            <div className="p-6 space-y-5 max-w-[1280px] mx-auto">
              <section className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-[var(--color-text)] truncate">
                        {selectedTask.title}
                      </h3>
                      <StatusBadge task={selectedTask} />
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)] line-clamp-2">
                      {selectedTask.scriptExcerpt}
                    </p>
                  </div>
                  <div className="inline-flex rounded-lg border border-[var(--color-border)] p-1 flex-shrink-0">
                    <button
                      onClick={() => setDetailView('current')}
                      className={`px-3 py-1.5 rounded-md text-sm ${detailView === 'current' ? 'bg-[var(--color-dark)] text-white' : 'text-gray-600'}`}
                    >
                      当前结果
                    </button>
                    <button
                      onClick={() => setDetailView('history')}
                      className={`px-3 py-1.5 rounded-md text-sm ${detailView === 'history' ? 'bg-[var(--color-dark)] text-white' : 'text-gray-600'}`}
                    >
                      历史版本
                    </button>
                  </div>
                </div>

                {detailView === 'current' ? (
                  <CurrentResultPanel
                    task={selectedTask}
                    imageRun={currentImageRun}
                    gridRun={currentGridRun}
                    resultView={resultView}
                    busy={busy}
                    onResultViewChange={setResultView}
                    onGenerateGrid={() => handleGenerateGrid()}
                    onToggleCandidate={(run, candidate) => toggleCandidate(run, candidate)}
                    onOpenCandidates={(run, openApply) => openCandidateDialog(run, openApply)}
                  />
                ) : (
                  <HistoryPanel
                    runs={runs}
                    currentImageRunId={selectedTask.currentImageRunId}
                    currentGridRunId={selectedTask.currentGridRunId}
                    busy={busy}
                    onSetCurrentImageRun={handleSetCurrentImageRun}
                    onSetCurrentGridRun={handleSetCurrentGridRun}
                    onGenerateGrid={handleGenerateGrid}
                    onOpenCandidates={(run, openApply) => openCandidateDialog(run, openApply)}
                    onPreviewImage={(run) => setHistoryPreview({ type: 'image', run })}
                    onPreviewGrid={(run) => setHistoryPreview({ type: 'grid', run })}
                  />
                )}
              </section>

              {detailView === 'current' && (
                <>
                  <CompositionInputsPanel
                    selectedTask={selectedTask}
                    characterOptions={characterOptions}
                    sceneOptions={sceneOptions}
                    itemOptions={itemOptions}
                    promptDraft={promptDraft}
                    imageSettings={imageSettings}
                    currentImageRun={currentImageRun}
                    currentGridRun={currentGridRun}
                    busy={busy}
                    onPatch={patchSelected}
                    onPromptChange={(next) => setPromptDrafts((prev) => ({ ...prev, [selectedTask.id]: next }))}
                    onImageSettingsChange={(next) => setImageSettingsByTask((prev) => ({
                      ...prev,
                      [selectedTask.id]: next,
                    }))}
                    onOpenReferenceDialog={setReferenceDialog}
                    onGenerateImage={handleGenerateImage}
                    onGenerateGrid={() => handleGenerateGrid()}
                  />

                  {(selectedTask.status === 'IMAGE_FAILED' || selectedTask.status === 'GRID_FAILED') && (
                    <div className="flex gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      <span>{selectedTask.error || '生成失败，可调整提示词或参数后重试。'}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </main>
      </div>
      )}

      {candidateDialogRun && selectedTask && (
        <CandidateDialog
          task={selectedTask}
          run={candidateDialogRun}
          busy={busy}
          applyMode={applyMode}
          showApplyPanel={showApplyPanel}
          onClose={closeCandidateDialog}
          onToggleCandidate={(candidate) => toggleCandidate(candidateDialogRun, candidate)}
          onShowApplyPanel={setShowApplyPanel}
          onApplyModeChange={setApplyMode}
          onApply={() => handleApplyCandidates(candidateDialogRun)}
          onGoStoryboard={() => router.push(`/projects/${project.id}/episodes/${selectedTask.episodeId}`)}
        />
      )}

      {historyPreview && selectedTask && (
        <HistoryPreviewDialog
          preview={historyPreview}
          currentImageRunId={selectedTask.currentImageRunId}
          currentGridRunId={selectedTask.currentGridRunId}
          busy={busy}
          onClose={() => setHistoryPreview(null)}
          onSetCurrentImageRun={handleSetCurrentImageRun}
          onSetCurrentGridRun={handleSetCurrentGridRun}
          onGenerateGrid={handleGenerateGrid}
          onOpenCandidates={(run, openApply) => {
            setHistoryPreview(null);
            openCandidateDialog(run, openApply);
          }}
        />
      )}

      {selectedTask && referenceDialog && (
        <ReferencePickerDialog
          activeView={referenceDialog}
          task={selectedTask}
          project={project}
          characterOptions={characterOptions}
          sceneOptions={sceneOptions}
          itemOptions={itemOptions}
          onRefreshReferences={onRefreshReferences}
          onViewChange={setReferenceDialog}
          onPatch={patchSelected}
          onClose={() => setReferenceDialog(null)}
        />
      )}
    </div>
  );
}

function CurrentResultPanel({
  task,
  imageRun,
  gridRun,
  resultView,
  busy,
  onResultViewChange,
  onGenerateGrid,
  onToggleCandidate,
  onOpenCandidates,
}: {
  task: CompositionTask;
  imageRun: CompositionImageRun | null;
  gridRun: CompositionGridRun | null;
  resultView: ResultView;
  busy: string | null;
  onResultViewChange: (view: ResultView) => void;
  onGenerateGrid: () => void;
  onToggleCandidate: (run: CompositionGridRun, candidate: CompositionCandidate) => void;
  onOpenCandidates: (run: CompositionGridRun, openApply?: boolean) => void;
}) {
  const isImageRunning = IMAGE_RUNNING_TASK_STATUSES.has(task.status) || (imageRun && RUNNING_RUN_STATUSES.has(imageRun.status));
  const isGridRunning = Boolean(gridRun && RUNNING_RUN_STATUSES.has(gridRun.status));
  const imageRunningLabel = imageGenerationStatusLabel(task, imageRun);
  const gridRunningLabel = gridGenerationStatusLabel(task, gridRun);
  const selectedCount = gridRun?.candidates.filter((candidate) => candidate.selected).length ?? 0;
  const hasApplied = gridRun?.candidates.some((candidate) => candidate.status === 'APPLIED' || candidate.syncedShotId) ?? false;
  return (
    <div className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-border)]">
        <div className="inline-flex rounded-lg border border-[var(--color-border)] p-1">
          <button
            onClick={() => onResultViewChange('image')}
            className={`px-3 py-1.5 rounded-md text-sm ${resultView === 'image' ? 'bg-[var(--color-dark)] text-white' : 'text-gray-600'}`}
          >
            场景图
          </button>
          <button
            onClick={() => onResultViewChange('grid')}
            className={`px-3 py-1.5 rounded-md text-sm ${resultView === 'grid' ? 'bg-[var(--color-dark)] text-white' : 'text-gray-600'}`}
          >
            分镜图网格
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
          {resultView === 'grid' && gridRun ? (
            isGridRunning ? (
              <span className="inline-flex items-center gap-1.5 text-blue-600">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {gridRunningLabel}
              </span>
            ) : (
              <>
                <span>候选 {gridRun.candidates.length}/9</span>
                <span>已选 {selectedCount}</span>
                {hasApplied && <span className="text-emerald-600">已进入分镜</span>}
              </>
            )
          ) : (
            <span>{imageRun?.image || task.image ? '当前镜头首帧' : '等待生成结果'}</span>
          )}
        </div>
      </div>

      <div className={`h-[clamp(360px,42vh,500px)] flex items-center justify-center p-4 ${
        resultView === 'grid' ? 'bg-gray-50' : 'bg-gray-950'
      }`}>
        {resultView === 'image' ? (
          imageRun?.image?.url || task.image?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageRun?.image?.url ?? task.image?.url} alt={task.title} className="max-w-full max-h-full object-contain" />
          ) : isImageRunning ? (
            <div className="flex flex-col items-center gap-2 text-white text-sm">
              <Loader2 className="w-7 h-7 animate-spin" />
              {imageRunningLabel}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-gray-400 text-sm">
              <ImageIcon className="w-8 h-8" />
              等待生成合成镜头图
            </div>
          )
        ) : isGridRunning ? (
          <div className="h-full max-h-[420px] aspect-video max-w-full grid grid-cols-3 grid-rows-3 gap-2">
            {Array.from({ length: 9 }, (_, index) => (
              <div
                key={index}
                className="min-h-0 rounded-lg border border-dashed border-gray-300 bg-white/75 flex items-center justify-center text-gray-400"
              >
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ))}
          </div>
        ) : gridRun?.candidates.length ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="grid grid-cols-3 grid-rows-3 gap-2 h-full max-h-[420px] aspect-video max-w-full">
            {gridRun.candidates.map((candidate) => (
              <button
                key={candidate.id}
                onClick={() => onToggleCandidate(gridRun, candidate)}
                className={`relative min-h-0 h-full rounded-lg overflow-hidden border transition-colors ${
                  candidate.selected
                    ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]'
                    : 'border-gray-200 hover:border-[var(--color-primary)]'
                }`}
              >
                {candidate.image?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={candidate.image.url} alt={`分镜候选 ${candidate.gridIndex}`} className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 bg-white flex items-center justify-center text-gray-400">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                )}
                <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/65 text-white text-xs">
                  {candidate.gridIndex} · {candidate.angleLabel ?? '候选'}
                </span>
                <span className={`absolute top-2 right-2 w-5 h-5 rounded-full border flex items-center justify-center ${
                  candidate.selected ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white' : 'bg-white/85 border-white text-transparent'
                }`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </span>
                {(candidate.status === 'APPLIED' || candidate.syncedShotId) && (
                  <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-xs">
                    已进入分镜
                  </span>
                )}
              </button>
            ))}
            </div>
          </div>
        ) : gridRun?.gridImage?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={gridRun.gridImage.url} alt="分镜网格" className="max-w-full max-h-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-3 text-gray-400 text-sm">
            <Grid3X3 className="w-8 h-8" />
            <span>{imageRun?.image ? '还没有生成 3x3 分镜网格' : '请先生成合成镜头图'}</span>
            <button
              onClick={onGenerateGrid}
              disabled={!imageRun?.image || busy === `grid-${imageRun?.id}`}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white text-[var(--color-text)] text-sm font-medium disabled:opacity-50"
            >
              {busy === `grid-${imageRun?.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Grid3X3 className="w-4 h-4" />}
              生成 3x3 分镜网格
            </button>
          </div>
        )}
      </div>

      {resultView === 'grid' && gridRun && gridRun.candidates.length > 0 && (
        <div className="px-4 py-3 border-t border-[var(--color-border)] flex items-center justify-between gap-3">
          <div className="text-xs text-[var(--color-text-secondary)]">
            点击九宫格图片可选择候选图，已选候选再应用到分镜流程。
          </div>
          <button
            onClick={() => onOpenCandidates(gridRun, true)}
            disabled={selectedCount === 0}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            应用到分镜{selectedCount > 0 ? ` ${selectedCount}` : ''}
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryPanel({
  runs,
  currentImageRunId,
  currentGridRunId,
  busy,
  onSetCurrentImageRun,
  onSetCurrentGridRun,
  onGenerateGrid,
  onOpenCandidates,
  onPreviewImage,
  onPreviewGrid,
}: {
  runs: CompositionTaskRuns | null;
  currentImageRunId: string | null;
  currentGridRunId: string | null;
  busy: string | null;
  onSetCurrentImageRun: (runId: string) => void;
  onSetCurrentGridRun: (runId: string) => void;
  onGenerateGrid: (runId: string) => void;
  onOpenCandidates: (run: CompositionGridRun, openApply?: boolean) => void;
  onPreviewImage: (run: CompositionImageRun) => void;
  onPreviewGrid: (run: CompositionGridRun) => void;
}) {
  if (!runs || (runs.imageRuns.length === 0 && runs.gridRuns.length === 0)) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
        暂无历史版本。每次生成镜头图或分镜网格都会保存在这里。
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold mb-3">镜头图历史</h3>
        <div className="grid grid-cols-3 gap-3">
          {runs.imageRuns.map((run) => (
            <div key={run.id} className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-white">
              <button
                onClick={() => onPreviewImage(run)}
                className="w-full bg-gray-950 flex items-center justify-center overflow-hidden"
                style={{ aspectRatio: ratioToCss(run.ratio) }}
              >
                {run.image?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={run.image.url} alt="" className="w-full h-full object-contain" />
                ) : RUNNING_RUN_STATUSES.has(run.status) ? (
                  <Loader2 className="w-5 h-5 animate-spin text-white" />
                ) : (
                  <ImageIcon className="w-6 h-6 text-gray-500" />
                )}
              </button>
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <RunStatusBadge status={run.status} />
                  {run.id === currentImageRunId && <span className="text-xs text-[var(--color-primary)]">当前</span>}
                </div>
                <div className="text-xs text-gray-500 space-y-1">
                  <div>{imageModelLabel(run.model)} · {run.ratio} · {qualityLabel(run.quality)}</div>
                  <div>{formatTime(run.createdAt)} · 消耗 {run.costCredits}</div>
                </div>
                {run.error && <div className="text-xs text-red-600">{run.error}</div>}
                <div className="flex gap-2">
                  <button
                    onClick={() => onSetCurrentImageRun(run.id)}
                    disabled={!run.image || run.id === currentImageRunId || busy === `current-${run.id}`}
                    className="flex-1 px-2 py-1.5 rounded-lg border border-[var(--color-border)] text-xs disabled:opacity-50 hover:border-[var(--color-primary)]"
                  >
                    设为当前
                  </button>
                  <button
                    onClick={() => onGenerateGrid(run.id)}
                    disabled={!run.image || busy === `grid-${run.id}`}
                    className="flex-1 px-2 py-1.5 rounded-lg border border-[var(--color-border)] text-xs disabled:opacity-50 hover:border-[var(--color-primary)]"
                  >
                    生成网格
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-3">分镜网格历史</h3>
        <div className="grid grid-cols-3 gap-3">
          {runs.gridRuns.map((run) => {
            const selectedCount = run.candidates.filter((candidate) => candidate.selected).length;
            return (
              <div key={run.id} className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-white">
                <button
                  onClick={() => onPreviewGrid(run)}
                  className="w-full bg-gray-100 flex items-center justify-center overflow-hidden"
                  style={{ aspectRatio: ratioToCss(run.ratio) }}
                >
                  {run.gridImage?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={run.gridImage.url} alt="" className="w-full h-full object-contain" />
                  ) : RUNNING_RUN_STATUSES.has(run.status) ? (
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  ) : (
                    <Grid3X3 className="w-6 h-6 text-gray-400" />
                  )}
                </button>
                <div className="p-3 text-xs text-gray-500 space-y-2">
                  <div className="flex items-center justify-between">
                    <RunStatusBadge status={run.status} />
                    {run.id === currentGridRunId && <span className="text-[var(--color-primary)]">当前</span>}
                  </div>
                  <div>3x3 · 候选 {run.candidates.length}/9 · 已选 {selectedCount}</div>
                  <div>{formatTime(run.createdAt)}</div>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <button
                      onClick={() => onOpenCandidates(run)}
                      disabled={run.candidates.length === 0}
                      className="px-2 py-1.5 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-primary)] disabled:opacity-50"
                    >
                      查看候选
                    </button>
                    <button
                      onClick={() => onSetCurrentGridRun(run.id)}
                      disabled={!run.gridImage || run.id === currentGridRunId || busy === `current-grid-${run.id}`}
                      className="px-2 py-1.5 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-primary)] disabled:opacity-50"
                    >
                      设当前
                    </button>
                    <button
                      onClick={() => onOpenCandidates(run, true)}
                      disabled={selectedCount === 0}
                      className="px-2 py-1.5 rounded-lg bg-[var(--color-dark)] text-white disabled:opacity-50"
                    >
                      应用
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function CompositionInputsPanel({
  selectedTask,
  characterOptions,
  sceneOptions,
  itemOptions,
  promptDraft,
  imageSettings,
  currentImageRun,
  currentGridRun,
  busy,
  onPatch,
  onPromptChange,
  onImageSettingsChange,
  onOpenReferenceDialog,
  onGenerateImage,
  onGenerateGrid,
}: {
  selectedTask: CompositionTask;
  characterOptions: Array<{ id: string; label: string; image: string }>;
  sceneOptions: Array<{ id: string; label: string; image: string }>;
  itemOptions: Array<{ id: string; label: string; image: string }>;
  promptDraft: string;
  imageSettings: ImageSettings;
  currentImageRun: CompositionImageRun | null;
  currentGridRun: CompositionGridRun | null;
  busy: string | null;
  onPatch: (patch: Parameters<typeof updateCompositionTask>[1]) => void;
  onPromptChange: (next: string) => void;
  onImageSettingsChange: (next: ImageSettings) => void;
  onOpenReferenceDialog: (view: ReferenceDialogView) => void;
  onGenerateImage: () => void;
  onGenerateGrid: () => void;
}) {
  const imageSubmitting = busy === `image-${selectedTask.id}`;
  const imageQueued = selectedTask.status === 'IMAGE_QUEUED' || currentImageRun?.status === 'QUEUED';
  const imageRunning = selectedTask.status === 'IMAGE_RUNNING' || currentImageRun?.status === 'RUNNING';
  const imageBusy = imageSubmitting || imageQueued || imageRunning;
  const imageButtonLabel = imageSubmitting
    ? '提交中…'
    : imageQueued
      ? '排队中…'
      : imageRunning
        ? '生成中…'
        : selectedTask.image
          ? '重新生成'
          : '生成镜头图';
  const gridSubmitting = currentImageRun ? busy === `grid-${currentImageRun.id}` : false;
  const gridQueued = selectedTask.status === 'GRID_QUEUED' || currentGridRun?.status === 'QUEUED';
  const gridRunning = selectedTask.status === 'GRID_RUNNING' || currentGridRun?.status === 'RUNNING';
  const gridBusy = gridSubmitting || gridQueued || gridRunning;
  const gridButtonLabel = gridSubmitting
    ? '提交中…'
    : gridQueued
      ? '网格排队中…'
      : gridRunning
        ? '网格生成中…'
        : '生成网格';
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-3">
      <div className="grid grid-cols-[220px_minmax(0,1fr)_320px] gap-3 items-start">
        <CompactReferenceBar
          task={selectedTask}
          characterOptions={characterOptions}
          sceneOptions={sceneOptions}
          itemOptions={itemOptions}
          onOpen={() => onOpenReferenceDialog('selected')}
        />

        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Clapperboard className="w-4 h-4" />
            提示词
          </div>
          <textarea
            value={promptDraft}
            onChange={(e) => onPromptChange(e.target.value)}
            onBlur={() => {
              if (promptDraft !== selectedTask.prompt) {
                onPatch({ prompt: promptDraft });
              }
            }}
            rows={3}
            className="w-full min-h-[92px] rounded-lg border border-[var(--color-border)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] outline-none px-3 py-2 text-sm leading-relaxed resize-none"
          />
        </div>

        <div className="space-y-2 min-w-0">
          <div className="text-sm font-semibold">生成配置</div>
          <SettingSelect
            label="模型"
            value={imageSettings.model}
            onChange={(model) => onImageSettingsChange({ ...imageSettings, model })}
            options={IMAGE_MODEL_OPTIONS.map((item) => ({ value: item.modelId, label: item.label }))}
          />
          <div className="grid grid-cols-3 gap-2">
            <SettingSelect
              label="比例"
              value={imageSettings.ratio}
              onChange={(ratio) => onImageSettingsChange({ ...imageSettings, ratio })}
              options={RATIOS.map((ratio) => ({ value: ratio, label: ratio }))}
            />
            <SettingSelect
              label="规格"
              value={imageSettings.quality}
              onChange={(quality) => onImageSettingsChange({ ...imageSettings, quality: quality as ImageSettings['quality'] })}
              options={QUALITY_OPTIONS}
            />
            <SettingSelect
              label="数量"
              value={String(imageSettings.outputCount)}
              onChange={(value) => onImageSettingsChange({ ...imageSettings, outputCount: Number(value) })}
              options={['1', '2', '4'].map((value) => ({ value, label: value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={onGenerateImage}
              disabled={imageBusy}
              className="inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {imageBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              {imageButtonLabel}
            </button>
            <button
              onClick={onGenerateGrid}
              disabled={!currentImageRun?.image || gridBusy}
              className="inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg border border-[var(--color-border)] text-xs font-medium hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
            >
              {gridBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Grid3X3 className="w-4 h-4" />}
              {gridButtonLabel}
            </button>
          </div>
          {(imageBusy || gridBusy) && (
            <div className="flex items-center gap-1.5 text-xs text-blue-600">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {imageBusy ? imageButtonLabel : gridButtonLabel}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function imageGenerationStatusLabel(
  task: CompositionTask,
  imageRun: CompositionImageRun | null,
): string {
  if (task.status === 'IMAGE_QUEUED' || imageRun?.status === 'QUEUED') return '合成镜头图排队中';
  if (task.status === 'IMAGE_RUNNING' || imageRun?.status === 'RUNNING') return '合成镜头图生成中';
  return '合成镜头图生成中';
}

function gridGenerationStatusLabel(
  task: CompositionTask,
  gridRun: CompositionGridRun | null,
): string {
  if (task.status === 'GRID_QUEUED' || gridRun?.status === 'QUEUED') return '分镜网格排队中';
  if (task.status === 'GRID_RUNNING' || gridRun?.status === 'RUNNING') return '分镜网格生成中';
  return '分镜网格生成中';
}

function CandidateDialog({
  task,
  run,
  busy,
  applyMode,
  showApplyPanel,
  onClose,
  onToggleCandidate,
  onShowApplyPanel,
  onApplyModeChange,
  onApply,
  onGoStoryboard,
}: {
  task: CompositionTask;
  run: CompositionGridRun;
  busy: string | null;
  applyMode: ApplyCompositionMode;
  showApplyPanel: boolean;
  onClose: () => void;
  onToggleCandidate: (candidate: CompositionCandidate) => void;
  onShowApplyPanel: (show: boolean) => void;
  onApplyModeChange: (mode: ApplyCompositionMode) => void;
  onApply: () => void;
  onGoStoryboard: () => void;
}) {
  const selectedCount = run.candidates.filter((candidate) => candidate.selected).length;
  const hasApplied = run.candidates.some((candidate) => candidate.status === 'APPLIED' || candidate.syncedShotId);
  return (
    <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-6">
      <div className="w-full max-w-[980px] max-h-[88vh] overflow-hidden rounded-xl bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div>
            <h3 className="font-semibold text-[var(--color-text)]">候选分镜</h3>
            <div className="text-xs text-[var(--color-text-secondary)]">
              {task.title} · 3x3 网格 · 已选 {selectedCount}/9
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center hover:border-[var(--color-primary)]"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {run.candidates.map((candidate) => (
              <button
                key={candidate.id}
                onClick={() => onToggleCandidate(candidate)}
                className={`relative aspect-video rounded-lg overflow-hidden border text-left group ${
                  candidate.selected
                    ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/20'
                    : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'
                }`}
              >
                {candidate.image?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={candidate.image.url} alt={`分镜候选 ${candidate.gridIndex}`} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400">
                    <ImageIcon className="w-5 h-5" />
                  </div>
                )}
                <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/65 text-white text-xs">
                  {candidate.gridIndex} · {candidate.angleLabel ?? '候选'}
                </span>
                <span className={`absolute top-2 right-2 w-5 h-5 rounded-full border flex items-center justify-center ${
                  candidate.selected ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white' : 'bg-white/90 border-white text-transparent'
                }`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </span>
                {(candidate.status === 'APPLIED' || candidate.syncedShotId) && (
                  <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-xs">
                    {candidate.syncedShotId ? '已进入分镜' : '已加入素材池'}
                  </span>
                )}
              </button>
            ))}
          </div>

          {showApplyPanel && (
            <div className="rounded-xl border border-[var(--color-border)] p-4 bg-gray-50/70">
              <div className="text-sm font-medium mb-3">选择应用方式</div>
              <div className="grid grid-cols-3 gap-2">
                <ModeButton
                  active={applyMode === 'create_shots'}
                  title="创建新 Shot"
                  description="候选图成为分镜草图"
                  onClick={() => onApplyModeChange('create_shots')}
                />
                <ModeButton
                  active={applyMode === 'replace_existing_shots'}
                  title="替换现有草图"
                  description="按当前场景 Shot 顺序替换"
                  onClick={() => onApplyModeChange('replace_existing_shots')}
                />
                <ModeButton
                  active={applyMode === 'add_to_storyboard_assets'}
                  title="加入素材池"
                  description="暂不创建 Shot，稍后再用"
                  onClick={() => onApplyModeChange('add_to_storyboard_assets')}
                />
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[var(--color-border)] flex items-center justify-between">
          <div className="text-xs text-gray-500">
            {formatTime(run.createdAt)} · 固定 3x3 分镜网格
            {hasApplied ? <span className="ml-2 text-emerald-600">已有候选图进入分镜流程</span> : null}
          </div>
          <div className="flex items-center gap-2">
            {hasApplied && (
              <button
                onClick={onGoStoryboard}
                className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm hover:border-[var(--color-primary)]"
              >
                查看分镜
              </button>
            )}
            <button
              onClick={() => onShowApplyPanel(!showApplyPanel)}
              disabled={selectedCount === 0}
              className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm disabled:opacity-50 hover:border-[var(--color-primary)]"
            >
              应用方式
            </button>
            <button
              onClick={onApply}
              disabled={selectedCount === 0 || busy === `apply-${run.id}`}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm disabled:opacity-50"
            >
              {busy === `apply-${run.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              应用到分镜
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryPreviewDialog({
  preview,
  currentImageRunId,
  currentGridRunId,
  busy,
  onClose,
  onSetCurrentImageRun,
  onSetCurrentGridRun,
  onGenerateGrid,
  onOpenCandidates,
}: {
  preview: Exclude<HistoryPreview, null>;
  currentImageRunId: string | null;
  currentGridRunId: string | null;
  busy: string | null;
  onClose: () => void;
  onSetCurrentImageRun: (runId: string) => void;
  onSetCurrentGridRun: (runId: string) => void;
  onGenerateGrid: (runId: string) => void;
  onOpenCandidates: (run: CompositionGridRun, openApply?: boolean) => void;
}) {
  const imageRun = preview.type === 'image' ? preview.run : null;
  const gridRun = preview.type === 'grid' ? preview.run : null;
  const run = imageRun ?? gridRun;
  if (!run) return null;
  const imageUrl = imageRun?.image?.url ?? gridRun?.gridImage?.url ?? null;
  const selectedCount = gridRun?.candidates.filter((candidate) => candidate.selected).length ?? 0;
  return (
    <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-6">
      <div className="w-full max-w-[1080px] max-h-[88vh] overflow-hidden rounded-xl bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div>
            <h3 className="font-semibold text-[var(--color-text)]">
              {imageRun ? '镜头图历史' : '分镜网格历史'}
            </h3>
            <div className="text-xs text-[var(--color-text-secondary)]">
              {formatTime(run.createdAt)} · {run.ratio}
              {imageRun ? ` · ${qualityLabel(imageRun.quality)}` : ` · 候选 ${gridRun?.candidates.length ?? 0}/9`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center hover:border-[var(--color-primary)]"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 bg-gray-950 p-5 flex items-center justify-center">
          <div
            className="max-w-full max-h-full bg-black/20 flex items-center justify-center overflow-hidden"
            style={{ aspectRatio: ratioToCss(run.ratio) }}
          >
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="max-w-full max-h-full object-contain" />
            ) : RUNNING_RUN_STATUSES.has(run.status) ? (
              <div className="flex items-center gap-2 text-white text-sm">
                <Loader2 className="w-5 h-5 animate-spin" />
                生成中
              </div>
            ) : (
              <ImageIcon className="w-8 h-8 text-gray-500" />
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[var(--color-border)] flex items-center justify-between gap-4">
          <div className="min-w-0 text-xs text-gray-500">
            <RunStatusBadge status={run.status} />
            <span className="ml-2">
              {imageRun
                ? `${imageModelLabel(run.model)} · 消耗 ${run.costCredits}`
                : `3x3 · 已选 ${selectedCount} · 消耗 ${run.costCredits}`}
            </span>
          </div>
          {imageRun ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onSetCurrentImageRun(imageRun.id)}
                disabled={!imageRun.image || imageRun.id === currentImageRunId || busy === `current-${imageRun.id}`}
                className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm disabled:opacity-50 hover:border-[var(--color-primary)]"
              >
                设为当前
              </button>
              <button
                onClick={() => onGenerateGrid(imageRun.id)}
                disabled={!imageRun.image || busy === `grid-${imageRun.id}`}
                className="px-3 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm disabled:opacity-50"
              >
                生成网格
              </button>
            </div>
          ) : gridRun ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onSetCurrentGridRun(gridRun.id)}
                disabled={!gridRun.gridImage || gridRun.id === currentGridRunId || busy === `current-grid-${gridRun.id}`}
                className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm disabled:opacity-50 hover:border-[var(--color-primary)]"
              >
                设为当前
              </button>
              <button
                onClick={() => onOpenCandidates(gridRun)}
                disabled={gridRun.candidates.length === 0}
                className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm disabled:opacity-50 hover:border-[var(--color-primary)]"
              >
                查看候选
              </button>
              <button
                onClick={() => onOpenCandidates(gridRun, true)}
                disabled={selectedCount === 0}
                className="px-3 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm disabled:opacity-50"
              >
                应用到分镜
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TaskListItem({
  task,
  active,
  onClick,
}: {
  task: CompositionTask;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${
        active
          ? 'border-[var(--color-primary)] bg-blue-50/60'
          : 'border-[var(--color-border)] hover:border-[var(--color-primary)] bg-white'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-16 aspect-video rounded-md overflow-hidden bg-gray-100 flex items-center justify-center flex-shrink-0">
          {task.image?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={task.image.url} alt="" className="w-full h-full object-cover" />
          ) : RUNNING_TASK_STATUSES.has(task.status) ? (
            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
          ) : (
            <Clapperboard className="w-4 h-4 text-gray-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{task.title}</div>
          <div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
            <span>{task.characterStyleIds.length} 角色</span>
            <span>{task.sceneIds.length} 场景</span>
            <span>{task.itemIds.length} 道具</span>
          </div>
          <div className="mt-1 text-xs text-gray-400">
            镜头图 {task.imageRunCount} · 网格 {task.gridRunCount}
          </div>
          <div className="mt-2">
            <StatusBadge task={task} />
          </div>
        </div>
      </div>
    </button>
  );
}

function StatusBadge({ task }: { task: CompositionTask }) {
  const meta = statusMeta(task.status);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function statusMeta(status: string) {
  if (status === 'DRAFT') return { label: '待生成', className: 'bg-gray-100 text-gray-600' };
  if (status === 'IMAGE_QUEUED' || status === 'IMAGE_RUNNING') {
    return { label: '生成中', className: 'bg-blue-50 text-blue-600' };
  }
  if (status === 'GRID_QUEUED' || status === 'GRID_RUNNING') {
    return { label: '网格生成中', className: 'bg-blue-50 text-blue-600' };
  }
  if (status === 'IMAGE_READY') return { label: '有镜头图', className: 'bg-indigo-50 text-indigo-600' };
  if (status === 'GRID_READY') return { label: '有候选', className: 'bg-purple-50 text-purple-600' };
  if (status === 'APPLIED' || status === 'SYNCED') {
    return { label: '已应用', className: 'bg-emerald-50 text-emerald-600' };
  }
  if (status === 'IMAGE_FAILED' || status === 'GRID_FAILED') return { label: '失败', className: 'bg-red-50 text-red-600' };
  return { label: status, className: 'bg-gray-100 text-gray-600' };
}

function RunStatusBadge({ status }: { status: string }) {
  const meta =
    status === 'SUCCEEDED' || status === 'READY'
      ? { label: '成功', className: 'bg-emerald-50 text-emerald-600' }
      : status === 'QUEUED' || status === 'RUNNING'
        ? { label: '生成中', className: 'bg-blue-50 text-blue-600' }
        : status === 'FAILED' || status === 'CANCELLED'
          ? { label: '失败', className: 'bg-red-50 text-red-600' }
          : { label: status, className: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function CompactReferenceBar({
  task,
  characterOptions,
  sceneOptions,
  itemOptions,
  onOpen,
}: {
  task: CompositionTask;
  characterOptions: Array<{ id: string; label: string; image: string }>;
  sceneOptions: Array<{ id: string; label: string; image: string }>;
  itemOptions: Array<{ id: string; label: string; image: string }>;
  onOpen: () => void;
}) {
  const compactLabel = (label: string) => label.split(' · ')[0]?.trim() || label;
  const selectedOptions = [
    ...characterOptions
      .filter((option) => task.characterStyleIds.includes(option.id))
      .map((option) => ({ ...option, kind: '角色' })),
    ...sceneOptions
      .filter((option) => task.sceneIds.includes(option.id))
      .map((option) => ({ ...option, kind: '场景' })),
    ...itemOptions
      .filter((option) => task.itemIds.includes(option.id))
      .map((option) => ({ ...option, kind: '道具' })),
  ];
  const slotCount = 6;
  const visibleOptions = selectedOptions.length > slotCount
    ? selectedOptions.slice(0, slotCount - 1)
    : selectedOptions.slice(0, slotCount);
  const hiddenCount = selectedOptions.length - visibleOptions.length;
  const emptySlots = Array.from({
    length: Math.max(0, slotCount - visibleOptions.length - (hiddenCount > 0 ? 1 : 0)),
  });

  return (
    <div className="h-full rounded-lg border border-[var(--color-border)] bg-gray-50/70 px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-primary)]"
          aria-label="打开引用资产管理"
        >
          <Layers3 className="w-4 h-4" />
          引用资产
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {visibleOptions.map((option) => (
          <button
            key={`${option.kind}-${option.id}`}
            type="button"
            onClick={onOpen}
            className="aspect-square rounded-md bg-white border border-[var(--color-border)] overflow-hidden flex items-center justify-center hover:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-1"
            title={`${option.kind} · ${option.label}`}
            aria-label={`管理${option.kind}：${option.label}`}
          >
            {option.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={option.image} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1.5 text-center">
                <ImageIcon className="w-4 h-4 shrink-0 text-gray-400" />
                <span className="line-clamp-2 max-w-full text-[10px] leading-3 text-gray-500">
                  {compactLabel(option.label)}
                </span>
              </span>
            )}
          </button>
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={onOpen}
            className="aspect-square rounded-md bg-white border border-[var(--color-border)] text-sm font-medium text-gray-500 flex items-center justify-center hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            aria-label="查看更多引用资产"
          >
            +{hiddenCount}
          </button>
        )}
        {emptySlots.map((_, index) => (
          <button
            key={`empty-${index}`}
            type="button"
            onClick={onOpen}
            className="aspect-square rounded-md border border-dashed border-[var(--color-border)] bg-white/70 flex items-center justify-center text-gray-300 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            aria-label="添加引用资产"
          >
            <Plus className="w-4 h-4" />
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-2 w-full text-left text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]"
      >
        已选 {selectedOptions.length} 个，点击管理引用
      </button>
    </div>
  );
}

type ReferencePickerOption = {
  id: string;
  label: string;
  image: string;
  kind: ReferenceKind;
  kindLabel: string;
  patchKey: 'characterStyleIds' | 'sceneIds' | 'itemIds';
  selectedIds: string[];
} & EditableReferenceOption;

function ReferencePickerCard({
  option,
  selected,
  generating,
  generationError,
  onToggle,
  onEdit,
  onPreview,
}: {
  option: ReferencePickerOption;
  selected: boolean;
  generating: boolean;
  generationError: string | null;
  onToggle: () => void;
  onEdit: () => void;
  onPreview: () => void;
}) {
  const hasImage = Boolean(option.image);

  return (
    <div
      className={`rounded-xl border overflow-hidden text-left transition-colors ${
        selected
          ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/15'
          : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'
      }`}
    >
      <button
        type="button"
        onClick={hasImage ? onPreview : selected ? undefined : onToggle}
        className={`block w-full text-left ${hasImage ? 'cursor-zoom-in' : selected ? 'cursor-default' : ''}`}
        aria-label={
          hasImage
            ? `放大查看${option.kindLabel}：${option.label}`
            : selected
              ? `${option.label} 已选`
              : `选择${option.kindLabel}：${option.label}`
        }
      >
        <div className="relative aspect-video bg-gray-100 flex items-center justify-center">
          {option.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={option.image}
              alt=""
              className={`w-full h-full ${referenceImageObjectClass(option.kind)}`}
            />
          ) : (
            <ImageIcon className="w-6 h-6 text-gray-400" />
          )}
          {generating && (
            <div className="absolute inset-0 bg-black/40 text-white flex flex-col items-center justify-center gap-1">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-xs">生成中...</span>
            </div>
          )}
        </div>
      </button>
      <div className="p-2 flex items-center gap-2">
        <button
          type="button"
          onClick={selected ? undefined : onToggle}
          className={`min-w-0 flex-1 text-left ${selected ? 'cursor-default' : 'hover:text-[var(--color-primary)]'}`}
          aria-label={selected ? `${option.label} 已选` : `选择${option.kindLabel}：${option.label}`}
        >
          <div className="min-w-0 flex-1">
            <div className="text-xs text-[var(--color-text)] truncate">{option.label}</div>
            <div className="text-[10px] text-[var(--color-text-secondary)]">{option.kindLabel}</div>
          </div>
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-label={selected ? `移除引用：${option.label}` : `选择引用：${option.label}`}
          title={selected ? '移除引用' : '选择引用'}
          className={`w-4 h-4 rounded border flex shrink-0 items-center justify-center ${
            selected ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-white' : 'border-gray-300'
          }`}>
            {selected && <CheckCircle2 className="w-3 h-3" />}
        </button>
      </div>
      {!option.image && (
        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={onEdit}
            disabled={generating}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs font-medium text-[var(--color-primary)] hover:border-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
            {generating ? '生成中...' : '生成图片'}
          </button>
          {generationError && !generating && (
            <div className="mt-1 line-clamp-2 text-[10px] leading-3 text-red-500">
              {generationError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReferencePickerDialog({
  activeView,
  task,
  project,
  characterOptions,
  sceneOptions,
  itemOptions,
  onRefreshReferences,
  onViewChange,
  onPatch,
  onClose,
}: {
  activeView: ReferenceDialogView;
  task: CompositionTask;
  project: Project;
  characterOptions: CharacterReferenceOption[];
  sceneOptions: SceneReferenceOption[];
  itemOptions: ItemReferenceOption[];
  onRefreshReferences?: () => Promise<void>;
  onViewChange: (view: ReferenceDialogView) => void;
  onPatch: (patch: Parameters<typeof updateCompositionTask>[1]) => void;
  onClose: () => void;
}) {
  const [editingOption, setEditingOption] = useState<ReferencePickerOption | null>(null);
  const [previewOption, setPreviewOption] = useState<ReferencePickerOption | null>(null);
  const { isGenerating, getError } = useGeneration();
  const groups: Record<ReferenceKind, {
    label: string;
    options: EditableReferenceOption[];
    selectedIds: string[];
    patchKey: 'characterStyleIds' | 'sceneIds' | 'itemIds';
  }> = {
    characters: {
      label: '角色造型',
      options: characterOptions,
      selectedIds: task.characterStyleIds,
      patchKey: 'characterStyleIds',
    },
    scenes: {
      label: '场景素材',
      options: sceneOptions,
      selectedIds: task.sceneIds,
      patchKey: 'sceneIds',
    },
    items: {
      label: '道具',
      options: itemOptions,
      selectedIds: task.itemIds,
      patchKey: 'itemIds',
    },
  };

  const toPickerOptions = (
    kind: ReferenceKind,
    options: EditableReferenceOption[],
  ): ReferencePickerOption[] =>
    options.map((option) => ({
      ...option,
      kind,
      kindLabel: groups[kind].label,
      patchKey: groups[kind].patchKey,
      selectedIds: groups[kind].selectedIds,
    } as ReferencePickerOption));

  const allOptions = [
    ...toPickerOptions('characters', characterOptions),
    ...toPickerOptions('scenes', sceneOptions),
    ...toPickerOptions('items', itemOptions),
  ];
  const selectedOptions = allOptions.filter((option) => option.selectedIds.includes(option.id));
  const activeGroup = activeView === 'selected' ? null : groups[activeView];
  const activeOptions = activeView === 'selected'
    ? selectedOptions
    : toPickerOptions(activeView, activeGroup?.options ?? []);
  const selectedCount = selectedOptions.length;

  const toggle = (kind: ReferenceKind, id: string) => {
    const group = groups[kind];
    const nextIds = group.selectedIds.includes(id)
      ? group.selectedIds.filter((selectedId) => selectedId !== id)
      : [...group.selectedIds, id];
    onPatch({ [group.patchKey]: nextIds });
  };
  const tabs: Array<{ key: ReferenceDialogView; label: string; count: number }> = [
    { key: 'selected', label: '已选', count: selectedCount },
    { key: 'characters', label: groups.characters.label, count: groups.characters.selectedIds.length },
    { key: 'scenes', label: groups.scenes.label, count: groups.scenes.selectedIds.length },
    { key: 'items', label: groups.items.label, count: groups.items.selectedIds.length },
  ];
  const editorConfig = editingOption
    ? referenceEditorConfig({
        option: editingOption,
        project,
        task,
        onRefreshReferences,
      })
    : null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/35 flex items-center justify-center p-6">
        <div className="w-full max-w-[900px] max-h-[84vh] rounded-xl bg-white shadow-2xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-[var(--color-text)]">选择引用资产</h3>
              <div className="text-xs text-[var(--color-text-secondary)]">
                用于场景图生成；缺少图片的素材可在这里直接生成或上传。
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center hover:border-[var(--color-primary)]"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-[var(--color-border)] p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => onViewChange(tab.key)}
                  className={`px-3 py-1.5 rounded-md text-sm ${
                    activeView === tab.key ? 'bg-[var(--color-dark)] text-white' : 'text-gray-600'
                  }`}
                >
                  {tab.label}
                  <span className="ml-1.5 text-xs opacity-70">{tab.count}</span>
                </button>
              ))}
            </div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2 text-sm text-gray-400">
              <Upload className="w-4 h-4" />
              上传在详情面板中完成
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <div className="grid grid-cols-4 gap-3">
              {activeOptions.map((option) => {
                const selected = option.selectedIds.includes(option.id);
                const generationKind = generationKindForReference(option.kind);
                const generating = isGenerating(generationKind, option.id);
                return (
                  <ReferencePickerCard
                    key={`${option.kind}-${option.id}`}
                    option={option}
                    selected={selected}
                    generating={generating}
                    generationError={getError(generationKind, option.id)}
                    onToggle={() => toggle(option.kind, option.id)}
                    onEdit={() => setEditingOption(option)}
                    onPreview={() => setPreviewOption(option)}
                  />
                );
              })}
            </div>
            {activeOptions.length === 0 && (
              <div className="border border-dashed border-gray-200 rounded-xl py-12 text-center text-sm text-gray-400">
                {activeView === 'selected' ? '还没有选择引用资产' : `暂无可选${activeGroup?.label ?? ''}`}
              </div>
            )}
          </div>

          <div className="px-5 py-4 border-t border-[var(--color-border)] flex items-center justify-between">
            <div className="text-xs text-[var(--color-text-secondary)]">
              当前已选 {selectedCount} 个引用资产
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[var(--color-dark)] text-white text-sm"
            >
              完成
            </button>
          </div>
        </div>
      </div>
      {editorConfig && (
        <EntityDetailDrawer
          open
          kind={editorConfig.kind}
          entity={editorConfig.entity}
          project={project}
          characterId={editorConfig.characterId}
          buildAutoPrompt={editorConfig.buildAutoPrompt}
          onSave={editorConfig.onSave}
          onClose={() => setEditingOption(null)}
        />
      )}
      {previewOption && (
        <ReferenceImagePreview
          option={previewOption}
          onClose={() => setPreviewOption(null)}
        />
      )}
    </>
  );
}

function ReferenceImagePreview({
  option,
  onClose,
}: {
  option: ReferencePickerOption;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] bg-black/75 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[90vh] flex flex-col gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 text-white">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{option.label}</div>
            <div className="text-xs text-white/65">{option.kindLabel}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center hover:bg-white/20"
            aria-label="关闭预览"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="min-h-[320px] max-h-[78vh] rounded-xl border border-white/15 bg-black/30 flex items-center justify-center overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={option.image}
            alt=""
            className="max-h-[78vh] w-full object-contain"
          />
        </div>
      </div>
    </div>
  );
}

type EntitySavePatch = {
  name?: string;
  description?: string;
  prompt?: string;
  model?: string | null;
  ratio?: string | null;
  assetId?: string | null;
};

type ReferenceEditorConfig = {
  kind: 'style' | 'scene' | 'item';
  entity: EntityDetailData;
  characterId?: string;
  buildAutoPrompt: () => string;
  onSave: (patch: EntitySavePatch) => Promise<EntityDetailData>;
};

function generationKindForReference(kind: ReferenceKind): GenerationKind {
  if (kind === 'characters') return 'style';
  if (kind === 'scenes') return 'scene';
  return 'item';
}

function referenceImageObjectClass(kind: ReferenceKind): string {
  return kind === 'scenes' ? 'object-cover' : 'object-contain';
}

function referenceEditorConfig({
  option,
  project,
  task,
  onRefreshReferences,
}: {
  option: ReferencePickerOption;
  project: Project;
  task: CompositionTask;
  onRefreshReferences?: () => Promise<void>;
}): ReferenceEditorConfig {
  const refreshReferences = async () => {
    await onRefreshReferences?.();
  };

  if (option.kind === 'characters') {
    const characterOption = option as ReferencePickerOption & CharacterReferenceOption;
    return {
      kind: 'style',
      characterId: characterOption.characterId,
      entity: {
        id: characterOption.id,
        name: characterOption.styleName,
        prompt: characterOption.prompt,
        model: characterOption.model,
        ratio: characterOption.ratio,
        image: characterOption.image,
        assetId: characterOption.assetId,
      },
      buildAutoPrompt: () =>
        buildResourceImagePrompt({
          kind: 'character-style',
          name: characterOption.characterName,
          description: characterOption.characterDescription,
          bio: characterOption.characterBio,
          styleName: characterOption.styleName,
          userPrompt: characterOption.prompt,
          projectStylePrompt: project.stylePrompt,
          ratio: characterOption.ratio || project.ratio,
        }),
      onSave: async (patch) => {
        const fresh = await updateCharacterStyle(characterOption.id, patch);
        await refreshReferences();
        return {
          id: fresh.id,
          name: fresh.name,
          prompt: fresh.prompt,
          model: fresh.model,
          ratio: fresh.ratio,
          image: fresh.image,
          assetId: fresh.assetId,
        };
      },
    };
  }

  if (option.kind === 'scenes') {
    const sceneOption = option as ReferencePickerOption & SceneReferenceOption;
    const scriptContext = task.scriptExcerpt ? `剧本节选：\n${task.scriptExcerpt}` : '';
    return {
      kind: 'scene',
      entity: {
        id: sceneOption.id,
        name: sceneOption.name,
        description: sceneOption.description,
        prompt: sceneOption.prompt,
        model: sceneOption.model,
        ratio: sceneOption.ratio,
        image: sceneOption.image,
        assetId: sceneOption.assetId,
      },
      buildAutoPrompt: () =>
        buildResourceImagePrompt({
          kind: 'scene',
          name: sceneOption.name,
          description: sceneOption.description,
          userPrompt: sceneOption.prompt || scriptContext,
          projectStylePrompt: project.stylePrompt,
          ratio: sceneOption.ratio || project.ratio,
        }),
      onSave: async (patch) => {
        const fresh = await updateScene(sceneOption.id, patch);
        await refreshReferences();
        return {
          id: fresh.id,
          name: fresh.name,
          description: fresh.description ?? '',
          prompt: fresh.prompt ?? '',
          model: fresh.model ?? null,
          ratio: fresh.ratio ?? null,
          image: fresh.image,
          assetId: fresh.assetId ?? null,
        };
      },
    };
  }

  const itemOption = option as ReferencePickerOption & ItemReferenceOption;
  const itemScriptContext = task.scriptExcerpt
    .split(/\n+/)
    .filter((line) => line.includes(itemOption.name))
    .slice(0, 6)
    .join('\n');
  return {
    kind: 'item',
    entity: {
      id: itemOption.id,
      name: itemOption.name,
      description: itemOption.description,
      prompt: itemOption.prompt,
      model: itemOption.model,
      ratio: itemOption.ratio,
      image: itemOption.image,
      assetId: itemOption.assetId,
    },
    buildAutoPrompt: () =>
      buildResourceImagePrompt({
        kind: 'item',
        name: itemOption.name,
        description: itemOption.description,
        userPrompt: itemOption.prompt || (itemScriptContext ? `剧本节选：\n${itemScriptContext}` : ''),
        projectStylePrompt: project.stylePrompt,
        ratio: itemOption.ratio || project.ratio,
      }),
    onSave: async (patch) => {
      const fresh = await updateItem(itemOption.id, patch);
      await refreshReferences();
      return {
        id: fresh.id,
        name: fresh.name,
        description: fresh.description ?? '',
        prompt: fresh.prompt ?? '',
        model: fresh.model ?? null,
        ratio: fresh.ratio ?? null,
        image: fresh.image,
        assetId: fresh.assetId ?? null,
      };
    },
  };
}

function SettingSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-[var(--color-text-secondary)] mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function ModeButton({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition-colors ${
        active
          ? 'border-[var(--color-primary)] bg-white text-[var(--color-primary)]'
          : 'border-[var(--color-border)] bg-white text-[var(--color-text)] hover:border-[var(--color-primary)]'
      }`}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs text-[var(--color-text-secondary)]">{description}</div>
    </button>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function ratioToCss(value: string | null | undefined) {
  const [w, h] = String(value ?? '').split(':').map((part) => Number(part));
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return `${w} / ${h}`;
  }
  return '16 / 9';
}

function qualityLabel(value: string) {
  if (value === '1080p') return '1080p';
  if (value === '2k') return '2K';
  if (value === '4k') return '4K';
  if (value === 'hd') return '2K';
  if (value === 'standard') return '1080p';
  return value;
}
