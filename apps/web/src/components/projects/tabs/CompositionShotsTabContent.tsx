'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
type ReferenceSelections = Record<ReferenceKind, string[]>;
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
  { value: 'image', label: '有场景图' },
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
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
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
  const patchQueuesRef = useRef<Record<string, Promise<void>>>({});

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

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const selectedTask = (selectedId ? taskById.get(selectedId) : null) ?? tasks[0] ?? null;
  const selectedTaskId = selectedTask?.id ?? null;
  const runs = selectedTask ? runsByTask[selectedTask.id] : null;
  const getCurrentImageRunForTask = useCallback((task: CompositionTask): CompositionImageRun | null => {
    const taskRuns = runsByTask[task.id];
    return taskRuns
      ? taskRuns.imageRuns.find((run) => run.id === task.currentImageRunId) ?? taskRuns.imageRuns[0] ?? null
      : null;
  }, [runsByTask]);
  const getCurrentGridRunForTask = useCallback((task: CompositionTask): CompositionGridRun | null => {
    const taskRuns = runsByTask[task.id];
    return taskRuns
      ? taskRuns.gridRuns.find((run) => run.id === task.currentGridRunId) ?? taskRuns.gridRuns[0] ?? null
      : null;
  }, [runsByTask]);
  const detailTask = detailTaskId ? taskById.get(detailTaskId) ?? null : null;
  const detailRuns = detailTask ? runsByTask[detailTask.id] ?? null : null;
  const detailImageRun = detailTask ? getCurrentImageRunForTask(detailTask) : null;
  const detailGridRun = detailTask ? getCurrentGridRunForTask(detailTask) : null;
  const candidateDialogRun = useMemo(() => {
    if (!candidateRunId) return null;
    for (const taskRuns of Object.values(runsByTask)) {
      const run = taskRuns.gridRuns.find((item) => item.id === candidateRunId);
      if (run) return run;
    }
    return null;
  }, [candidateRunId, runsByTask]);
  const candidateDialogTask = candidateDialogRun ? taskById.get(candidateDialogRun.taskId) ?? null : null;
  const historyPreviewTask = historyPreview ? taskById.get(historyPreview.run.taskId) ?? selectedTask : selectedTask;
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

  const clearBusy = (key: string) => {
    setBusy((current) => (current === key ? null : current));
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
      clearBusy('analyze');
    }
  };

  const patchTask = async (taskId: string, patch: Parameters<typeof updateCompositionTask>[1]) => {
    const busyKey = `patch-${taskId}`;
    const runPatch = async () => {
      setBusy(busyKey);
      setError(null);
      try {
        const next = await updateCompositionTask(taskId, patch);
        updateTaskInList(next);
        void reloadRuns(next.id).catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败');
      } finally {
        clearBusy(busyKey);
      }
    };
    const previous = patchQueuesRef.current[taskId] ?? Promise.resolve();
    const queued = previous.catch(() => {}).then(runPatch);
    patchQueuesRef.current[taskId] = queued;
    try {
      await queued;
    } finally {
      if (patchQueuesRef.current[taskId] === queued) {
        delete patchQueuesRef.current[taskId];
      }
    }
  };

  const patchSelected = async (patch: Parameters<typeof updateCompositionTask>[1]) => {
    if (!selectedTask) return;
    await patchTask(selectedTask.id, patch);
  };

  const savePromptIfNeeded = async (taskId: string) => {
    const task = taskById.get(taskId);
    if (!task) throw new Error('合成任务不存在');
    const draft = promptDrafts[taskId] ?? task.prompt;
    if (draft === task.prompt) return task;
    const next = await updateCompositionTask(task.id, { prompt: draft });
    updateTaskInList(next);
    return next;
  };

  const handleGenerateImage = async (taskId = selectedTask?.id) => {
    if (!taskId) return;
    const busyKey = `image-${taskId}`;
    setBusy(busyKey);
    setError(null);
    try {
      await patchQueuesRef.current[taskId]?.catch(() => {});
      const taskForPrompt = await savePromptIfNeeded(taskId);
      const payload: CompositionImageGenerationSettings =
        imageSettingsByTask[taskId] ?? defaultImageSettings(project);
      const next = await generateCompositionImage(taskForPrompt.id, payload);
      updateTaskInList(next);
      await reloadRuns(next.id);
      setDetailView('current');
      setResultView('image');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成场景图失败');
    } finally {
      clearBusy(busyKey);
    }
  };

  const handleGenerateGrid = async (
    imageRunId?: string,
    taskId = selectedTask?.id,
  ) => {
    if (!taskId) return;
    const task = taskById.get(taskId);
    if (!task) return;
    const targetImageRunId = imageRunId ?? getCurrentImageRunForTask(task)?.id;
    if (!targetImageRunId) return;
    const busyKey = `grid-${targetImageRunId}`;
    setBusy(busyKey);
    setError(null);
    try {
      await patchQueuesRef.current[task.id]?.catch(() => {});
      const taskRuns = runsByTask[task.id] ?? null;
      const sourceRun =
        taskRuns?.imageRuns.find((run) => run.id === targetImageRunId) ??
        getCurrentImageRunForTask(task);
      const next = await generateCompositionGrid(targetImageRunId, {
        model: sourceRun?.model ?? project.imageModel,
        ratio: sourceRun?.ratio ?? project.ratio,
        specification: '3x3',
      });
      updateTaskInList(next);
      await reloadRuns(next.id);
      setDetailView('current');
      setResultView('grid');
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成分镜图失败');
    } finally {
      clearBusy(busyKey);
    }
  };

  const handleSetCurrentImageRun = async (runId: string) => {
    if (!selectedTask) return;
    const busyKey = `current-${runId}`;
    setBusy(busyKey);
    setError(null);
    try {
      const next = await setCurrentCompositionImageRun(runId);
      updateTaskInList(next);
      await reloadRuns(next.id);
      setDetailView('current');
      setResultView('image');
    } catch (e) {
      setError(e instanceof Error ? e.message : '设置当前场景图失败');
    } finally {
      clearBusy(busyKey);
    }
  };

  const handleSetCurrentGridRun = async (runId: string) => {
    if (!selectedTask) return;
    const busyKey = `current-grid-${runId}`;
    setBusy(busyKey);
    setError(null);
    try {
      const next = await setCurrentCompositionGridRun(runId);
      updateTaskInList(next);
      await reloadRuns(next.id);
      setDetailView('current');
      setResultView('grid');
      setHistoryPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '设置当前分镜图失败');
    } finally {
      clearBusy(busyKey);
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
    const selectedIds = run.candidates
      .filter((item) => item.selected !== (item.id === candidate.id))
      .map((item) => item.id);
    void patchTask(run.taskId, { selectedCandidateIds: selectedIds });
  };

  const handleApplyCandidates = async (run: CompositionGridRun) => {
    const candidateIds = run.candidates
      .filter((candidate) => candidate.selected)
      .map((candidate) => candidate.id);
    const busyKey = `apply-${run.id}`;
    setBusy(busyKey);
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
      clearBusy(busyKey);
    }
  };

  const openDetailDrawer = (task: CompositionTask, view: ResultView = task.currentGridRunId ? 'grid' : 'image') => {
    setSelectedId(task.id);
    setDetailTaskId(task.id);
    setDetailView('current');
    setResultView(view);
    void reloadRuns(task.id).catch(() => {});
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
            版本化保存场景图和分镜图，候选图从当前分镜图或历史分镜图中按需应用
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
              卡片
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
            onGenerateImage={() => handleGenerateImage(selectedTask.id)}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50/70">
          <div className="mx-auto flex max-w-[1680px] flex-col gap-4 px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {FILTERS.map((item) => (
                  <button
                    key={item.value}
                    onClick={() => setFilter(item.value)}
                    className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                      filter === item.value
                        ? 'bg-[var(--color-dark)] text-white border-[var(--color-dark)]'
                        : 'border-[var(--color-border)] bg-white text-gray-600 hover:border-[var(--color-primary)]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="text-xs text-[var(--color-text-secondary)]">
                当前 {filteredTasks.length} / {tasks.length} 个合成任务
              </div>
            </div>

            <div className="space-y-4">
              {filteredTasks.map((task, index) => {
                const taskImageRun = getCurrentImageRunForTask(task);
                const taskSettings = imageSettingsByTask[task.id] ?? defaultImageSettings(project);
                const taskPromptDraft = promptDrafts[task.id] ?? task.prompt;
                return (
                  <CompositionTaskRow
                    key={task.id}
                    task={task}
                    index={index + 1}
                    active={detailTask?.id === task.id}
                    promptDraft={taskPromptDraft}
                    imageSettings={taskSettings}
                    imageRun={taskImageRun}
                    busy={busy}
                    characterOptions={characterOptions}
                    sceneOptions={sceneOptions}
                    itemOptions={itemOptions}
                    onPromptChange={(next) => setPromptDrafts((prev) => ({ ...prev, [task.id]: next }))}
                    onPromptBlur={(next) => {
                      if (next !== task.prompt) {
                        void patchTask(task.id, { prompt: next });
                      }
                    }}
                    onImageSettingsChange={(next) => setImageSettingsByTask((prev) => ({
                      ...prev,
                      [task.id]: next,
                    }))}
                    onOpenReferences={() => {
                      setSelectedId(task.id);
                      setReferenceDialog('selected');
                    }}
                    onGenerateImage={() => handleGenerateImage(task.id)}
                    onOpenDetail={(view) => openDetailDrawer(task, view)}
                  />
                );
              })}
              {filteredTasks.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 bg-white py-14 text-center text-sm text-gray-400">
                  当前筛选下没有任务
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {viewMode === 'panel' && detailTask && (
        <CompositionDetailDrawer
          task={detailTask}
          runs={detailRuns}
          imageRun={detailImageRun}
          gridRun={detailGridRun}
          detailView={detailView}
          resultView={resultView}
          busy={busy}
          onClose={() => setDetailTaskId(null)}
          onDetailViewChange={setDetailView}
          onResultViewChange={setResultView}
          onGenerateGrid={(runId) => handleGenerateGrid(runId, detailTask.id)}
          onToggleCandidate={(run, candidate) => toggleCandidate(run, candidate)}
          onOpenCandidates={(run, openApply) => openCandidateDialog(run, openApply)}
          onSetCurrentImageRun={handleSetCurrentImageRun}
          onSetCurrentGridRun={handleSetCurrentGridRun}
          onPreviewImage={(run) => setHistoryPreview({ type: 'image', run })}
          onPreviewGrid={(run) => setHistoryPreview({ type: 'grid', run })}
        />
      )}

      {candidateDialogRun && candidateDialogTask && (
        <CandidateDialog
          task={candidateDialogTask}
          run={candidateDialogRun}
          busy={busy}
          applyMode={applyMode}
          showApplyPanel={showApplyPanel}
          onClose={closeCandidateDialog}
          onToggleCandidate={(candidate) => toggleCandidate(candidateDialogRun, candidate)}
          onShowApplyPanel={setShowApplyPanel}
          onApplyModeChange={setApplyMode}
          onApply={() => handleApplyCandidates(candidateDialogRun)}
          onGoStoryboard={() => router.push(`/projects/${project.id}/episodes/${candidateDialogTask.episodeId}`)}
        />
      )}

      {historyPreview && historyPreviewTask && (
        <HistoryPreviewDialog
          preview={historyPreview}
          currentImageRunId={historyPreviewTask.currentImageRunId}
          currentGridRunId={historyPreviewTask.currentGridRunId}
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
          key={selectedTask.id}
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

type RowReferenceItem = {
  id: string;
  label: string;
  kind: '角色' | '场景' | '道具';
  image: string;
};

function selectedReferenceItems(
  task: CompositionTask,
  characterOptions: Array<{ id: string; label: string; image: string }>,
  sceneOptions: Array<{ id: string; label: string; image: string }>,
  itemOptions: Array<{ id: string; label: string; image: string }>,
): RowReferenceItem[] {
  return [
    ...characterOptions
      .filter((option) => task.characterStyleIds.includes(option.id))
      .map((option) => ({ id: option.id, label: option.label, image: option.image, kind: '角色' as const })),
    ...sceneOptions
      .filter((option) => task.sceneIds.includes(option.id))
      .map((option) => ({ id: option.id, label: option.label, image: option.image, kind: '场景' as const })),
    ...itemOptions
      .filter((option) => task.itemIds.includes(option.id))
      .map((option) => ({ id: option.id, label: option.label, image: option.image, kind: '道具' as const })),
  ];
}

function compactReferenceLabel(label: string): string {
  return label.split(' · ')[0]?.trim() || label;
}

function CompositionTaskRow({
  task,
  index,
  active,
  promptDraft,
  imageSettings,
  imageRun,
  busy,
  characterOptions,
  sceneOptions,
  itemOptions,
  onPromptChange,
  onPromptBlur,
  onImageSettingsChange,
  onOpenReferences,
  onGenerateImage,
  onOpenDetail,
}: {
  task: CompositionTask;
  index: number;
  active: boolean;
  promptDraft: string;
  imageSettings: ImageSettings;
  imageRun: CompositionImageRun | null;
  busy: string | null;
  characterOptions: Array<{ id: string; label: string; image: string }>;
  sceneOptions: Array<{ id: string; label: string; image: string }>;
  itemOptions: Array<{ id: string; label: string; image: string }>;
  onPromptChange: (next: string) => void;
  onPromptBlur: (next: string) => void;
  onImageSettingsChange: (next: ImageSettings) => void;
  onOpenReferences: () => void;
  onGenerateImage: () => void;
  onOpenDetail: (view?: ResultView) => void;
}) {
  const references = selectedReferenceItems(task, characterOptions, sceneOptions, itemOptions);
  return (
    <section
      className={`rounded-lg border bg-white shadow-sm transition-colors ${
        active ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/15' : 'border-[var(--color-border)]'
      }`}
    >
      <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-[48px_minmax(360px,1.15fr)_280px_minmax(360px,0.9fr)]">
        <div className="flex items-start">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-50 text-sm font-semibold text-[var(--color-text)]">
            {index}
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-[var(--color-text)]">{task.title}</h3>
              <StatusBadge task={task} />
              {(task.status === 'IMAGE_FAILED' || task.status === 'GRID_FAILED') && (
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-text-secondary)]">
              {task.scriptExcerpt}
            </p>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">提示词</span>
            <textarea
              value={promptDraft}
              onChange={(event) => onPromptChange(event.target.value)}
              onBlur={(event) => onPromptBlur(event.currentTarget.value)}
              rows={7}
              className="min-h-[196px] w-full resize-none rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm leading-6 outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
            />
          </label>
          {task.error && (task.status === 'IMAGE_FAILED' || task.status === 'GRID_FAILED') && (
            <div className="line-clamp-2 text-xs leading-5 text-red-600">{task.error}</div>
          )}
        </div>

        <ReferenceColumn
          references={references}
          onOpen={onOpenReferences}
        />

        <SceneImageColumn
          task={task}
          imageRun={imageRun}
          imageSettings={imageSettings}
          busy={busy}
          onImageSettingsChange={onImageSettingsChange}
          onGenerateImage={onGenerateImage}
          onOpenDetail={onOpenDetail}
        />
      </div>
    </section>
  );
}

function ReferenceColumn({
  references,
  onOpen,
}: {
  references: RowReferenceItem[];
  onOpen: () => void;
}) {
  const visible = references.slice(0, 8);
  const hiddenCount = references.length - visible.length;
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <Layers3 className="h-4 w-4" />
          参考图
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
        >
          <Plus className="h-3.5 w-3.5" />
          管理
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {visible.map((item) => (
          <button
            key={`${item.kind}-${item.id}`}
            type="button"
            onClick={onOpen}
            title={`${item.kind} · ${item.label}`}
            className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--color-border)] bg-gray-50 text-left hover:border-[var(--color-primary)]"
          >
            {item.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.image} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1.5 text-center">
                <ImageIcon className="h-4 w-4 text-gray-400" />
                <span className="line-clamp-2 text-[10px] leading-3 text-gray-500">{compactReferenceLabel(item.label)}</span>
              </div>
            )}
            <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] text-white">
              {item.kind}
            </span>
          </button>
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={onOpen}
            className="aspect-square rounded-lg border border-dashed border-[var(--color-border)] bg-white text-sm font-medium text-gray-500 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
          >
            +{hiddenCount}
          </button>
        )}
      </div>
      {references.length === 0 && (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-h-[196px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--color-border)] bg-white text-sm text-gray-400 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
        >
          <Plus className="h-5 w-5" />
          添加参考图
        </button>
      )}
      {references.length > 0 && (
        <button
          type="button"
          onClick={onOpen}
          className="w-full text-left text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]"
        >
          已选 {references.length} 个参考，点击调整
        </button>
      )}
    </div>
  );
}

function SceneImageColumn({
  task,
  imageRun,
  imageSettings,
  busy,
  onImageSettingsChange,
  onGenerateImage,
  onOpenDetail,
}: {
  task: CompositionTask;
  imageRun: CompositionImageRun | null;
  imageSettings: ImageSettings;
  busy: string | null;
  onImageSettingsChange: (next: ImageSettings) => void;
  onGenerateImage: () => void;
  onOpenDetail: (view?: ResultView) => void;
}) {
  const taskSaving = busy === `patch-${task.id}`;
  const imageSubmitting = busy === `image-${task.id}`;
  const imageQueued = task.status === 'IMAGE_QUEUED' || imageRun?.status === 'QUEUED';
  const imageRunning = task.status === 'IMAGE_RUNNING' || imageRun?.status === 'RUNNING';
  const imageBusy = taskSaving || imageSubmitting || imageQueued || imageRunning;
  const imageButtonLabel = taskSaving
    ? '保存中...'
    : imageSubmitting
      ? '提交中...'
      : imageQueued
        ? '排队中...'
        : imageRunning
          ? '生成中...'
          : task.image
            ? '重新生成场景图'
            : '生成场景图';
  const imageUrl = imageRun?.image?.url ?? task.image?.url ?? null;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <ImageIcon className="h-4 w-4" />
          场景图
        </div>
        <button
          type="button"
          onClick={() => onOpenDetail(task.currentGridRunId ? 'grid' : 'image')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
        >
          <Grid3X3 className="h-3.5 w-3.5" />
          详情
        </button>
      </div>

      <button
        type="button"
        onClick={() => onOpenDetail('image')}
        className="flex min-h-[196px] w-full items-center justify-center overflow-hidden rounded-lg bg-gray-950 text-sm text-gray-400"
        style={{ aspectRatio: ratioToCss(imageSettings.ratio) }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={task.title} className="h-full w-full object-contain" />
        ) : imageBusy ? (
          <span className="flex flex-col items-center gap-2 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
            {imageGenerationStatusLabel(task, imageRun)}
          </span>
        ) : (
          <span className="flex flex-col items-center gap-2">
            <ImageIcon className="h-7 w-7" />
            等待生成场景图
          </span>
        )}
      </button>

      <div className="space-y-2">
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
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
        <button
          type="button"
          onClick={onGenerateImage}
          disabled={imageBusy}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {imageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {imageButtonLabel}
        </button>
        <button
          type="button"
          onClick={() => onOpenDetail('grid')}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
        >
          <Grid3X3 className="h-4 w-4" />
          分镜图
        </button>
      </div>
    </div>
  );
}

function CompositionDetailDrawer({
  task,
  runs,
  imageRun,
  gridRun,
  detailView,
  resultView,
  busy,
  onClose,
  onDetailViewChange,
  onResultViewChange,
  onGenerateGrid,
  onToggleCandidate,
  onOpenCandidates,
  onSetCurrentImageRun,
  onSetCurrentGridRun,
  onPreviewImage,
  onPreviewGrid,
}: {
  task: CompositionTask;
  runs: CompositionTaskRuns | null;
  imageRun: CompositionImageRun | null;
  gridRun: CompositionGridRun | null;
  detailView: DetailView;
  resultView: ResultView;
  busy: string | null;
  onClose: () => void;
  onDetailViewChange: (view: DetailView) => void;
  onResultViewChange: (view: ResultView) => void;
  onGenerateGrid: (imageRunId?: string) => void;
  onToggleCandidate: (run: CompositionGridRun, candidate: CompositionCandidate) => void;
  onOpenCandidates: (run: CompositionGridRun, openApply?: boolean) => void;
  onSetCurrentImageRun: (runId: string) => void;
  onSetCurrentGridRun: (runId: string) => void;
  onPreviewImage: (run: CompositionImageRun) => void;
  onPreviewGrid: (run: CompositionGridRun) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex bg-black/25">
      <button
        type="button"
        className="flex-1 cursor-default"
        onClick={onClose}
        aria-label="关闭详情"
      />
      <aside className="flex h-full w-full max-w-[900px] flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold text-[var(--color-text)]">{task.title}</h3>
              <StatusBadge task={task} />
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-text-secondary)]">
              {task.scriptExcerpt}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] hover:border-[var(--color-primary)]"
            aria-label="关闭详情"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3">
          <div className="inline-flex rounded-lg border border-[var(--color-border)] p-1">
            <button
              type="button"
              onClick={() => onDetailViewChange('current')}
              className={`rounded-md px-3 py-1.5 text-sm ${detailView === 'current' ? 'bg-[var(--color-dark)] text-white' : 'text-gray-600'}`}
            >
              当前结果
            </button>
            <button
              type="button"
              onClick={() => onDetailViewChange('history')}
              className={`rounded-md px-3 py-1.5 text-sm ${detailView === 'history' ? 'bg-[var(--color-dark)] text-white' : 'text-gray-600'}`}
            >
              历史版本
            </button>
          </div>
          <div className="text-xs text-[var(--color-text-secondary)]">
            场景图 {task.imageRunCount} · 分镜图 {task.gridRunCount}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {detailView === 'current' ? (
            <div className="space-y-4">
              <CurrentResultPanel
                task={task}
                imageRun={imageRun}
                gridRun={gridRun}
                resultView={resultView}
                busy={busy}
                onResultViewChange={onResultViewChange}
                onGenerateGrid={() => onGenerateGrid()}
                onToggleCandidate={onToggleCandidate}
                onOpenCandidates={onOpenCandidates}
              />
              {(task.status === 'IMAGE_FAILED' || task.status === 'GRID_FAILED') && (
                <div className="flex gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-600">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{task.error || '生成失败，可调整提示词或参数后重试。'}</span>
                </div>
              )}
            </div>
          ) : (
            <HistoryPanel
              runs={runs}
              currentImageRunId={task.currentImageRunId}
              currentGridRunId={task.currentGridRunId}
              busy={busy}
              onSetCurrentImageRun={onSetCurrentImageRun}
              onSetCurrentGridRun={onSetCurrentGridRun}
              onGenerateGrid={(runId) => onGenerateGrid(runId)}
              onOpenCandidates={onOpenCandidates}
              onPreviewImage={onPreviewImage}
              onPreviewGrid={onPreviewGrid}
            />
          )}
        </div>
      </aside>
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
            分镜图
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
            <span>{imageRun?.image || task.image ? '当前场景图' : '等待生成结果'}</span>
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
              等待生成场景图
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
          <img src={gridRun.gridImage.url} alt="分镜图" className="max-w-full max-h-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-3 text-gray-400 text-sm">
            <Grid3X3 className="w-8 h-8" />
            <span>{imageRun?.image ? '还没有生成 3x3 分镜图' : '请先生成场景图'}</span>
            <button
              onClick={onGenerateGrid}
              disabled={!imageRun?.image || busy === `grid-${imageRun?.id}`}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white text-[var(--color-text)] text-sm font-medium disabled:opacity-50"
            >
              {busy === `grid-${imageRun?.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Grid3X3 className="w-4 h-4" />}
              生成 3x3 分镜图
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
        暂无历史版本。每次生成场景图或分镜图都会保存在这里。
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold mb-3">场景图历史</h3>
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
                    生成分镜图
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-3">分镜图历史</h3>
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
                  <div>3x3 分镜图 · 候选 {run.candidates.length}/9 · 已选 {selectedCount}</div>
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

function imageGenerationStatusLabel(
  task: CompositionTask,
  imageRun: CompositionImageRun | null,
): string {
  if (task.status === 'IMAGE_QUEUED' || imageRun?.status === 'QUEUED') return '场景图排队中';
  if (task.status === 'IMAGE_RUNNING' || imageRun?.status === 'RUNNING') return '场景图生成中';
  return '场景图生成中';
}

function gridGenerationStatusLabel(
  task: CompositionTask,
  gridRun: CompositionGridRun | null,
): string {
  if (task.status === 'GRID_QUEUED' || gridRun?.status === 'QUEUED') return '分镜图排队中';
  if (task.status === 'GRID_RUNNING' || gridRun?.status === 'RUNNING') return '分镜图生成中';
  return '分镜图生成中';
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
              {task.title} · 3x3 分镜图 · 已选 {selectedCount}/9
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
            {formatTime(run.createdAt)} · 固定 3x3 分镜图
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
              {imageRun ? '场景图历史' : '分镜图历史'}
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
                : `3x3 分镜图 · 已选 ${selectedCount} · 消耗 ${run.costCredits}`}
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
                生成分镜图
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
    return { label: '分镜生成中', className: 'bg-blue-50 text-blue-600' };
  }
  if (status === 'IMAGE_READY') return { label: '有场景图', className: 'bg-indigo-50 text-indigo-600' };
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
  const [draftSelections, setDraftSelections] = useState<ReferenceSelections>(() => ({
    characters: task.characterStyleIds,
    scenes: task.sceneIds,
    items: task.itemIds,
  }));
  const draftSelectionsRef = useRef<ReferenceSelections>(draftSelections);
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
      selectedIds: draftSelections.characters,
      patchKey: 'characterStyleIds',
    },
    scenes: {
      label: '场景素材',
      options: sceneOptions,
      selectedIds: draftSelections.scenes,
      patchKey: 'sceneIds',
    },
    items: {
      label: '道具',
      options: itemOptions,
      selectedIds: draftSelections.items,
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
    const currentSelections = draftSelectionsRef.current;
    const currentIds = currentSelections[kind];
    const nextIds = currentIds.includes(id)
      ? currentIds.filter((selectedId) => selectedId !== id)
      : [...currentIds, id];
    const nextSelections = {
      ...currentSelections,
      [kind]: nextIds,
    };
    draftSelectionsRef.current = nextSelections;
    setDraftSelections(nextSelections);
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
