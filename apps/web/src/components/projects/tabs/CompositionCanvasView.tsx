'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnNodesChange,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import {
  Box,
  CheckCircle2,
  Clapperboard,
  Image as ImageIcon,
  Loader2,
  Map as MapIcon,
  Settings2,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import {
  CompositionImageRun,
  CompositionTask,
  CompositionTaskRuns,
} from '@/types';
import { IMAGE_MODEL_OPTIONS, imageModelLabel } from '@/data/style-presets';

type CanvasResourceKind = 'character' | 'item' | 'scene';

type CanvasResourceOption = {
  id: string;
  label: string;
  image: string;
};

type CanvasResource = CanvasResourceOption & {
  kind: CanvasResourceKind;
};

type ImageSettings = {
  model: string;
  ratio: string;
  quality: '1080p' | '2k' | '4k';
  outputCount: number;
  negativePrompt: string;
};

type CompositionPatch = Partial<{
  prompt: string;
  characterStyleIds: string[];
  sceneIds: string[];
  itemIds: string[];
  selectedCandidateIds: string[];
}>;

type ResourceNodeData = {
  kind: CanvasResourceKind;
  label: string;
  image: string;
  selected: boolean;
};

type CompositionNodeData = {
  task: CompositionTask;
  promptDraft: string;
  imageSettings: ImageSettings;
  selectedResources: CanvasResource[];
  currentImageRun: CompositionImageRun | null;
  busy: string | null;
  onPromptChange: (next: string) => void;
  onPromptBlur: (next: string) => void;
  onImageSettingsChange: (next: ImageSettings) => void;
  onOpenSettings: () => void;
  onGenerateImage: () => void;
};

type ResourceCanvasNode = Node<ResourceNodeData, 'resource'>;
type CompositionCanvasNode = Node<CompositionNodeData, 'composition'>;
type CanvasNode = ResourceCanvasNode | CompositionCanvasNode;
type CanvasEdge = Edge;

type Props = {
  projectId: string;
  tasks: CompositionTask[];
  selectedTask: CompositionTask;
  runs: CompositionTaskRuns | null;
  characterOptions: CanvasResourceOption[];
  sceneOptions: CanvasResourceOption[];
  itemOptions: CanvasResourceOption[];
  promptDraft: string;
  imageSettings: ImageSettings;
  busy: string | null;
  onSelectTask: (taskId: string) => void;
  onPatch: (patch: CompositionPatch) => void | Promise<void>;
  onPromptChange: (next: string) => void;
  onImageSettingsChange: (next: ImageSettings) => void;
  onGenerateImage: () => void;
};

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const QUALITY_OPTIONS: Array<{ value: ImageSettings['quality']; label: string }> = [
  { value: '1080p', label: '1080p' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
];
const KIND_ORDER: CanvasResourceKind[] = ['character', 'item', 'scene'];
const KIND_META: Record<CanvasResourceKind, { label: string; patchKey: 'characterStyleIds' | 'itemIds' | 'sceneIds' }> = {
  character: { label: '角色', patchKey: 'characterStyleIds' },
  item: { label: '道具', patchKey: 'itemIds' },
  scene: { label: '场景', patchKey: 'sceneIds' },
};

const NODE_TYPES = {
  resource: ResourceNode,
  composition: CompositionNode,
};

export function CompositionCanvasView(props: Props) {
  return (
    <ReactFlowProvider>
      <CompositionCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CompositionCanvasInner({
  projectId,
  tasks,
  selectedTask,
  runs,
  characterOptions,
  sceneOptions,
  itemOptions,
  promptDraft,
  imageSettings,
  busy,
  onSelectTask,
  onPatch,
  onPromptChange,
  onImageSettingsChange,
  onGenerateImage,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>([]);

  const resources = useMemo(
    () => ({
      character: characterOptions.map((option) => ({ ...option, kind: 'character' as const })),
      item: itemOptions.map((option) => ({ ...option, kind: 'item' as const })),
      scene: sceneOptions.map((option) => ({ ...option, kind: 'scene' as const })),
    }),
    [characterOptions, itemOptions, sceneOptions],
  );

  const allResources = useMemo(
    () => [...resources.character, ...resources.item, ...resources.scene],
    [resources],
  );

  const selectedResources = useMemo(() => {
    const byKind = new Map(allResources.map((resource) => [resourceNodeId(resource.kind, resource.id), resource]));
    return KIND_ORDER.flatMap((kind) =>
      selectedIdsForKind(selectedTask, kind)
        .map((id) => byKind.get(resourceNodeId(kind, id)))
        .filter((resource): resource is CanvasResource => Boolean(resource)),
    );
  }, [allResources, selectedTask]);

  const currentImageRun =
    runs?.imageRuns.find((run) => run.id === selectedTask.currentImageRunId) ??
    runs?.imageRuns[0] ??
    null;

  useEffect(() => {
    setNodes((previous) => {
      const previousPositions = new Map(previous.map((node) => [node.id, node.position]));
      return buildNodes({
        task: selectedTask,
        resources,
        selectedResources,
        promptDraft,
        imageSettings,
        currentImageRun,
        busy,
        previousPositions,
        onPromptChange,
        onPromptBlur: (next) => {
          if (next !== selectedTask.prompt) void onPatch({ prompt: next });
        },
        onImageSettingsChange,
        onOpenSettings: () => setSettingsOpen(true),
        onGenerateImage,
      });
    });
  }, [
    busy,
    currentImageRun,
    imageSettings,
    onGenerateImage,
    onImageSettingsChange,
    onPatch,
    onPromptChange,
    promptDraft,
    resources,
    selectedResources,
    selectedTask,
    setNodes,
  ]);

  useEffect(() => {
    setEdges(buildEdges(selectedTask, allResources, Boolean(currentImageRun && isRunInFlight(currentImageRun.status))));
  }, [allResources, currentImageRun, selectedTask, setEdges]);

  const handleNodesChange = useCallback<OnNodesChange<CanvasNode>>(
    (changes) => onNodesChange(changes),
    [onNodesChange],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const parsed = parseResourceNodeId(connection.source);
      if (!parsed || connection.target !== taskNodeId(selectedTask.id)) return;
      const currentIds = selectedIdsForKind(selectedTask, parsed.kind);
      if (currentIds.includes(parsed.id)) return;
      const nextIds = [...currentIds, parsed.id];
      void onPatch({ [KIND_META[parsed.kind].patchKey]: nextIds });
    },
    [onPatch, selectedTask],
  );

  const handleEdgesDelete = useCallback(
    (deletedEdges: CanvasEdge[]) => {
      let characterStyleIds = [...selectedTask.characterStyleIds];
      let itemIds = [...selectedTask.itemIds];
      let sceneIds = [...selectedTask.sceneIds];

      for (const edge of deletedEdges) {
        const parsed = parseEdgeId(edge.id);
        if (!parsed) continue;
        if (parsed.kind === 'character') characterStyleIds = characterStyleIds.filter((id) => id !== parsed.id);
        if (parsed.kind === 'item') itemIds = itemIds.filter((id) => id !== parsed.id);
        if (parsed.kind === 'scene') sceneIds = sceneIds.filter((id) => id !== parsed.id);
      }

      void onPatch({ characterStyleIds, itemIds, sceneIds });
    },
    [onPatch, selectedTask],
  );

  const storageKey = `oneness:composition-canvas-task:${projectId}`;
  useEffect(() => {
    window.localStorage.setItem(storageKey, selectedTask.id);
  }, [selectedTask.id, storageKey]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[#0f1115]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onEdgesDelete={handleEdgesDelete}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.25}
        maxZoom={1.8}
        className="composition-canvas-flow"
      >
        <Background color="#303642" gap={24} size={1} />
        <Controls position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(node) => (node.type === 'composition' ? '#d7ff14' : '#1f2937')}
        />
        <Panel position="top-left" className="rounded-xl border border-white/10 bg-[#171a20]/95 p-3 shadow-2xl">
          <label className="block">
            <span className="mb-1 block text-xs text-white/55">当前任务</span>
            <select
              value={selectedTask.id}
              onChange={(event) => onSelectTask(event.target.value)}
              className="nodrag w-[280px] rounded-lg border border-white/10 bg-[#22262d] px-3 py-2 text-sm text-white outline-none focus:border-[#d7ff14]"
            >
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
        </Panel>
      </ReactFlow>

      {settingsOpen && (
        <CanvasSettingsDrawer
          imageSettings={imageSettings}
          onImageSettingsChange={onImageSettingsChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function buildNodes({
  task,
  resources,
  selectedResources,
  promptDraft,
  imageSettings,
  currentImageRun,
  busy,
  previousPositions,
  onPromptChange,
  onPromptBlur,
  onImageSettingsChange,
  onOpenSettings,
  onGenerateImage,
}: {
  task: CompositionTask;
  resources: Record<CanvasResourceKind, CanvasResource[]>;
  selectedResources: CanvasResource[];
  promptDraft: string;
  imageSettings: ImageSettings;
  currentImageRun: CompositionImageRun | null;
  busy: string | null;
  previousPositions: Map<string, { x: number; y: number }>;
  onPromptChange: (next: string) => void;
  onPromptBlur: (next: string) => void;
  onImageSettingsChange: (next: ImageSettings) => void;
  onOpenSettings: () => void;
  onGenerateImage: () => void;
}): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  let y = 40;

  for (const kind of KIND_ORDER) {
    for (const resource of resources[kind]) {
      const id = resourceNodeId(kind, resource.id);
      nodes.push({
        id,
        type: 'resource',
        position: previousPositions.get(id) ?? { x: 40, y },
        data: {
          kind,
          label: resource.label,
          image: resource.image,
          selected: selectedIdsForKind(task, kind).includes(resource.id),
        },
      });
      y += 154;
    }
    y += 28;
  }

  const compositionNodeId = taskNodeId(task.id);
  nodes.push({
    id: compositionNodeId,
    type: 'composition',
    position: previousPositions.get(compositionNodeId) ?? { x: 560, y: 120 },
    data: {
      task,
      promptDraft,
      imageSettings,
      selectedResources,
      currentImageRun,
      busy,
      onPromptChange,
      onPromptBlur,
      onImageSettingsChange,
      onOpenSettings,
      onGenerateImage,
    },
  });

  return nodes;
}

function buildEdges(
  task: CompositionTask,
  allResources: CanvasResource[],
  animated: boolean,
): CanvasEdge[] {
  const available = new Set(allResources.map((resource) => resourceNodeId(resource.kind, resource.id)));
  return KIND_ORDER.flatMap((kind) =>
    selectedIdsForKind(task, kind)
      .filter((id) => available.has(resourceNodeId(kind, id)))
      .map((id) => ({
        id: edgeId(kind, id, task.id),
        source: resourceNodeId(kind, id),
        sourceHandle: 'out',
        target: taskNodeId(task.id),
        targetHandle: kind,
        type: 'smoothstep',
        animated,
        style: {
          stroke: edgeColor(kind),
          strokeWidth: 2,
        },
      })),
  );
}

function ResourceNode({ data }: NodeProps<ResourceCanvasNode>) {
  const Icon = data.kind === 'character' ? UserRound : data.kind === 'item' ? Box : MapIcon;
  return (
    <div
      className={`w-[156px] overflow-hidden rounded-xl border bg-[#191d24] shadow-2xl ${
        data.selected ? 'border-[#d7ff14]' : 'border-white/10'
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-white/80">
          <Icon className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">{KIND_META[data.kind].label}</span>
        </div>
        {data.selected && <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-[#d7ff14]" />}
      </div>
      <div className="h-[106px] bg-[#0f1115]">
        {data.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.image} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-white/35">
            <ImageIcon className="h-6 w-6" />
          </div>
        )}
      </div>
      <div className="px-2.5 py-2 text-xs text-white/75">
        <div className="line-clamp-2 min-h-[32px] leading-4">{data.label}</div>
      </div>
      <Handle
        type="source"
        id="out"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-[#0f1115] !bg-[#60a5fa]"
      />
    </div>
  );
}

function CompositionNode({ data }: NodeProps<CompositionCanvasNode>) {
  const task = data.task;
  const imageSubmitting = data.busy === `image-${task.id}`;
  const imageQueued = task.status === 'IMAGE_QUEUED' || data.currentImageRun?.status === 'QUEUED';
  const imageRunning = task.status === 'IMAGE_RUNNING' || data.currentImageRun?.status === 'RUNNING';
  const imageBusy = imageSubmitting || imageQueued || imageRunning;
  const imageButtonLabel = imageSubmitting
    ? '提交中...'
    : imageQueued
      ? '排队中...'
      : imageRunning
        ? '生成中...'
        : task.image
          ? '重新生成'
          : '生成';

  return (
    <div className="relative w-[470px] rounded-xl border border-[#d7ff14] bg-[#1a1e24] text-white shadow-2xl">
      {KIND_ORDER.map((kind, index) => (
        <Handle
          key={kind}
          type="target"
          id={kind}
          position={Position.Left}
          style={{ top: 122 + index * 34 }}
          className="!h-3 !w-3 !border-2 !border-[#0f1115]"
        />
      ))}

      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Clapperboard className="h-4 w-4 text-[#d7ff14]" />
            <span className="truncate">{task.title}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/50">{task.scriptExcerpt}</p>
        </div>
        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs ${statusClass(task.status)}`}>
          {statusLabel(task.status)}
        </span>
      </div>

      <div className="space-y-3 p-4">
        <textarea
          value={data.promptDraft}
          onChange={(event) => data.onPromptChange(event.target.value)}
          onBlur={(event) => data.onPromptBlur(event.target.value)}
          className="nodrag nowheel h-[118px] w-full resize-none rounded-lg border border-white/10 bg-[#11151b] px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/30 focus:border-[#d7ff14]"
          placeholder="描述想要生成的合成镜头..."
        />

        <div className="flex items-center gap-2 overflow-hidden">
          {data.selectedResources.slice(0, 7).map((resource) => (
            <div
              key={`${resource.kind}-${resource.id}`}
              className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#11151b]"
              title={`${KIND_META[resource.kind].label} · ${resource.label}`}
            >
              {resource.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={resource.image} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-white/35">
                  <ImageIcon className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}
          {data.selectedResources.length > 7 && (
            <span className="rounded-lg border border-white/10 px-2 py-2 text-xs text-white/60">
              +{data.selectedResources.length - 7}
            </span>
          )}
          {data.selectedResources.length === 0 && (
            <span className="text-xs text-white/40">暂无引用资产</span>
          )}
        </div>

        {data.currentImageRun?.image?.url && (
          <div className="h-[132px] overflow-hidden rounded-lg border border-white/10 bg-[#0f1115]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={data.currentImageRun.image.url} alt="" className="h-full w-full object-contain" />
          </div>
        )}

        {task.error && (task.status === 'IMAGE_FAILED' || task.status === 'GRID_FAILED') && (
          <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {task.error}
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_92px_36px_92px] gap-2">
          <CanvasSelect
            label="模型"
            value={data.imageSettings.model}
            onChange={(model) => data.onImageSettingsChange({ ...data.imageSettings, model })}
            options={IMAGE_MODEL_OPTIONS.map((item) => ({ value: item.modelId, label: item.label }))}
          />
          <CanvasSelect
            label="数量"
            value={String(data.imageSettings.outputCount)}
            onChange={(value) => data.onImageSettingsChange({ ...data.imageSettings, outputCount: Number(value) })}
            options={['1', '2', '4'].map((value) => ({ value, label: value }))}
          />
          <button
            type="button"
            onClick={data.onOpenSettings}
            className="nodrag mt-5 flex h-9 items-center justify-center rounded-lg border border-white/10 bg-[#252b33] text-white/75 hover:border-[#d7ff14] hover:text-[#d7ff14]"
            aria-label="打开高级配置"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={data.onGenerateImage}
            disabled={imageBusy}
            className="nodrag mt-5 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#d7ff14] px-3 text-xs font-semibold text-black hover:bg-[#c7ef0d] disabled:opacity-60"
          >
            {imageBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {imageButtonLabel}
          </button>
        </div>

        <div className="text-xs text-white/35">
          {imageModelLabel(data.imageSettings.model)} · {data.imageSettings.ratio} · {qualityLabel(data.imageSettings.quality)}
        </div>
      </div>
    </div>
  );
}

function CanvasSettingsDrawer({
  imageSettings,
  onImageSettingsChange,
  onClose,
}: {
  imageSettings: ImageSettings;
  onImageSettingsChange: (next: ImageSettings) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-y-0 right-0 z-10 w-[320px] border-l border-white/10 bg-[#171a20] text-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
        <div className="text-sm font-semibold">高级配置</div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-white/70 hover:border-[#d7ff14] hover:text-[#d7ff14]"
          aria-label="关闭高级配置"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-4 p-4">
        <CanvasSelect
          label="比例"
          value={imageSettings.ratio}
          onChange={(ratio) => onImageSettingsChange({ ...imageSettings, ratio })}
          options={RATIOS.map((ratio) => ({ value: ratio, label: ratio }))}
        />
        <CanvasSelect
          label="规格"
          value={imageSettings.quality}
          onChange={(quality) => onImageSettingsChange({ ...imageSettings, quality: quality as ImageSettings['quality'] })}
          options={QUALITY_OPTIONS}
        />
        <label className="block">
          <span className="mb-1 block text-xs text-white/55">Negative Prompt</span>
          <textarea
            value={imageSettings.negativePrompt}
            onChange={(event) => onImageSettingsChange({ ...imageSettings, negativePrompt: event.target.value })}
            rows={6}
            className="w-full resize-none rounded-lg border border-white/10 bg-[#11151b] px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-white/30 focus:border-[#d7ff14]"
            placeholder="不希望出现的画面元素"
          />
        </label>
      </div>
    </div>
  );
}

function CanvasSelect({
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
      <span className="mb-1 block text-xs text-white/55">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="nodrag w-full rounded-lg border border-white/10 bg-[#252b33] px-2.5 py-2 text-sm text-white outline-none focus:border-[#d7ff14]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function selectedIdsForKind(task: CompositionTask, kind: CanvasResourceKind) {
  if (kind === 'character') return task.characterStyleIds;
  if (kind === 'item') return task.itemIds;
  return task.sceneIds;
}

function resourceNodeId(kind: CanvasResourceKind, id: string) {
  return `${kind}:${id}`;
}

function taskNodeId(taskId: string) {
  return `task:${taskId}`;
}

function edgeId(kind: CanvasResourceKind, id: string, taskId: string) {
  return `${kind}:${id}->task:${taskId}`;
}

function parseResourceNodeId(nodeId: string | null | undefined): { kind: CanvasResourceKind; id: string } | null {
  if (!nodeId) return null;
  const [kind, ...rest] = nodeId.split(':');
  if (!isCanvasResourceKind(kind)) return null;
  const id = rest.join(':');
  return id ? { kind, id } : null;
}

function parseEdgeId(id: string): { kind: CanvasResourceKind; id: string } | null {
  const [resourcePart] = id.split('->task:');
  return parseResourceNodeId(resourcePart);
}

function isCanvasResourceKind(value: string): value is CanvasResourceKind {
  return value === 'character' || value === 'item' || value === 'scene';
}

function edgeColor(kind: CanvasResourceKind) {
  if (kind === 'character') return '#60a5fa';
  if (kind === 'item') return '#f59e0b';
  return '#34d399';
}

function isRunInFlight(status: string) {
  return status === 'QUEUED' || status === 'RUNNING';
}

function statusLabel(status: string) {
  if (status === 'DRAFT') return '待生成';
  if (status === 'IMAGE_QUEUED' || status === 'IMAGE_RUNNING') return '生成中';
  if (status === 'GRID_QUEUED' || status === 'GRID_RUNNING') return '网格生成中';
  if (status === 'IMAGE_READY') return '有镜头图';
  if (status === 'GRID_READY') return '有候选';
  if (status === 'APPLIED' || status === 'SYNCED') return '已应用';
  if (status === 'IMAGE_FAILED' || status === 'GRID_FAILED') return '失败';
  return status;
}

function statusClass(status: string) {
  if (status === 'DRAFT') return 'bg-white/10 text-white/60';
  if (status === 'IMAGE_QUEUED' || status === 'IMAGE_RUNNING' || status === 'GRID_QUEUED' || status === 'GRID_RUNNING') {
    return 'bg-blue-400/15 text-blue-200';
  }
  if (status === 'IMAGE_READY') return 'bg-indigo-400/15 text-indigo-200';
  if (status === 'GRID_READY') return 'bg-purple-400/15 text-purple-200';
  if (status === 'APPLIED' || status === 'SYNCED') return 'bg-emerald-400/15 text-emerald-200';
  if (status === 'IMAGE_FAILED' || status === 'GRID_FAILED') return 'bg-red-400/15 text-red-200';
  return 'bg-white/10 text-white/60';
}

function qualityLabel(value: string) {
  if (value === '1080p') return '1080p';
  if (value === '2k') return '2K';
  if (value === '4k') return '4K';
  if (value === 'hd') return '2K';
  if (value === 'standard') return '1080p';
  return value;
}
