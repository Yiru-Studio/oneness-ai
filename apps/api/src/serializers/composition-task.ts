import type {
  Asset,
  CompositionCandidate,
  CompositionGridRun,
  CompositionImageRun,
  CompositionTask,
  Task,
  TaskAsset,
} from '@oneness/shared/prisma';
import { serializeOptionalAsset, type AssetDTO } from '../lib/assets.js';

type TaskAssetWithAsset = TaskAsset & { asset: Asset };
type TaskWithAssets = Task & { assets: TaskAssetWithAsset[] };

export type CompositionCandidateDTO = {
  id: string;
  taskId: string;
  gridRunId: string | null;
  gridIndex: number;
  angleLabel: string | null;
  image: AssetDTO | null;
  selected: boolean;
  syncedShotId: string | null;
  status: string;
  appliedMode: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompositionImageRunDTO = {
  id: string;
  taskId: string;
  prompt: string;
  negativePrompt: string;
  model: string;
  ratio: string;
  quality: string;
  outputCount: number;
  seed: string | null;
  characterConsistency: number;
  sceneConsistency: number;
  itemConsistency: number;
  params: unknown;
  referenceAssetIds: string[];
  characterStyleIds: string[];
  sceneIds: string[];
  itemIds: string[];
  status: string;
  error: string | null;
  costCredits: number;
  taskJobId: string | null;
  taskJobStatus: string | null;
  image: AssetDTO | null;
  createdAt: string;
  updatedAt: string;
};

export type CompositionGridRunDTO = {
  id: string;
  taskId: string;
  imageRunId: string;
  model: string;
  ratio: string;
  specification: string;
  variationMode: string;
  consistency: number;
  inheritStyle: boolean;
  inheritSeed: boolean;
  params: unknown;
  status: string;
  error: string | null;
  costCredits: number;
  taskJobId: string | null;
  taskJobStatus: string | null;
  gridImage: AssetDTO | null;
  candidates: CompositionCandidateDTO[];
  createdAt: string;
  updatedAt: string;
};

export type CompositionTaskDTO = {
  id: string;
  projectId: string;
  episodeId: string;
  sceneIndex: number;
  title: string;
  scriptExcerpt: string;
  prompt: string;
  characterStyleIds: string[];
  sceneIds: string[];
  itemIds: string[];
  status: string;
  error: string | null;
  currentImageRunId: string | null;
  currentGridRunId: string | null;
  image: AssetDTO | null;
  imageTaskId: string | null;
  imageTaskStatus: string | null;
  gridImage: AssetDTO | null;
  candidates: CompositionCandidateDTO[];
  imageRunCount: number;
  gridRunCount: number;
  candidateCount: number;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompositionTaskRunsDTO = {
  taskId: string;
  currentImageRunId: string | null;
  currentGridRunId: string | null;
  imageRuns: CompositionImageRunDTO[];
  gridRuns: CompositionGridRunDTO[];
};

type CandidateWithAsset = CompositionCandidate & { asset: Asset | null };
type ImageRunWithRelations = CompositionImageRun & {
  outputAsset: Asset | null;
  taskJob: TaskWithAssets | null;
};
type GridRunWithRelations = CompositionGridRun & {
  gridAsset: Asset | null;
  taskJob?: TaskWithAssets | null;
  candidates: CandidateWithAsset[];
};
type CompositionTaskWithRelations = CompositionTask & {
  imageAsset?: Asset | null;
  imageTask?: TaskWithAssets | null;
  gridAsset?: Asset | null;
  currentImageRun: ImageRunWithRelations | null;
  currentGridRun: GridRunWithRelations | null;
  candidates: CandidateWithAsset[];
  _count?: {
    imageRuns?: number;
    gridRuns?: number;
    candidates?: number;
  };
};

function jsonStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string') : [];
}

function taskOutputAsset(job: TaskWithAssets | null | undefined): Asset | null {
  return job?.assets.find((a) => a.role === 'output')?.asset ?? null;
}

function imageRunOutput(row: ImageRunWithRelations | null | undefined): Asset | null {
  if (!row) return null;
  return row.outputAsset ?? taskOutputAsset(row.taskJob);
}

function statusFromImageRun(row: ImageRunWithRelations | null | undefined): string | null {
  if (!row) return null;
  if (row.status === 'SUCCEEDED' || row.outputAssetId || taskOutputAsset(row.taskJob)) return 'IMAGE_READY';
  if (row.status === 'FAILED' || row.status === 'CANCELLED') return 'IMAGE_FAILED';
  if (row.status === 'RUNNING') return 'IMAGE_RUNNING';
  if (row.status === 'QUEUED') return 'IMAGE_QUEUED';
  return null;
}

function taskStatusFromGridRun(row: GridRunWithRelations | null | undefined): string | null {
  if (!row) return null;
  const status = row.taskJob?.status ?? row.status;
  if ((row.candidates.length ?? 0) > 0 || row.gridAssetId || taskOutputAsset(row.taskJob)) return 'GRID_READY';
  if (status === 'FAILED' || status === 'CANCELLED') return 'GRID_FAILED';
  if (status === 'RUNNING') return 'GRID_RUNNING';
  if (status === 'QUEUED') return 'GRID_QUEUED';
  return null;
}

function derivedStatus(row: CompositionTaskWithRelations): string {
  if (row.status === 'APPLIED' || row.status === 'SYNCED' || row.syncedAt) return 'APPLIED';
  if (row.currentGridRun?.candidates.some((candidate) => candidate.status === 'APPLIED' || candidate.syncedShotId)) return 'APPLIED';
  if ((row.currentGridRun?.candidates.length ?? 0) > 0 || row.currentGridRun?.gridAssetId) return 'GRID_READY';
  const gridStatus = taskStatusFromGridRun(row.currentGridRun);
  if (gridStatus) return gridStatus;
  const imageStatus = statusFromImageRun(row.currentImageRun);
  if (imageStatus) return imageStatus;
  if (row.candidates.length > 0 || row.gridAssetId) return 'GRID_READY';
  if (row.imageAssetId) return 'IMAGE_READY';
  if (row.imageTask?.status === 'SUCCEEDED' && row.imageTask.assets.some((a) => a.role === 'output')) return 'IMAGE_READY';
  if (row.imageTask?.status === 'FAILED' || row.imageTask?.status === 'CANCELLED') return 'IMAGE_FAILED';
  if (row.imageTask?.status === 'RUNNING') return 'IMAGE_RUNNING';
  if (row.imageTask?.status === 'QUEUED') return 'IMAGE_QUEUED';
  return row.status;
}

export async function serializeCandidate(row: CandidateWithAsset): Promise<CompositionCandidateDTO> {
  return {
    id: row.id,
    taskId: row.taskId,
    gridRunId: row.gridRunId,
    gridIndex: row.gridIndex,
    angleLabel: row.angleLabel,
    image: await serializeOptionalAsset(row.asset),
    selected: row.selected,
    syncedShotId: row.syncedShotId,
    status: row.status,
    appliedMode: row.appliedMode,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function serializeCompositionImageRun(
  row: ImageRunWithRelations,
): Promise<CompositionImageRunDTO> {
  return {
    id: row.id,
    taskId: row.taskId,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt,
    model: row.model,
    ratio: row.ratio,
    quality: row.quality,
    outputCount: row.outputCount,
    seed: row.seed,
    characterConsistency: row.characterConsistency,
    sceneConsistency: row.sceneConsistency,
    itemConsistency: row.itemConsistency,
    params: row.params,
    referenceAssetIds: jsonStringArray(row.referenceAssetIds),
    characterStyleIds: jsonStringArray(row.characterStyleIds),
    sceneIds: jsonStringArray(row.sceneIds),
    itemIds: jsonStringArray(row.itemIds),
    status: row.status,
    error: row.error ?? row.taskJob?.error ?? null,
    costCredits: row.costCredits,
    taskJobId: row.taskJobId,
    taskJobStatus: row.taskJob?.status ?? null,
    image: await serializeOptionalAsset(imageRunOutput(row)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function serializeCompositionGridRun(
  row: GridRunWithRelations,
): Promise<CompositionGridRunDTO> {
  return {
    id: row.id,
    taskId: row.taskId,
    imageRunId: row.imageRunId,
    model: row.model,
    ratio: row.ratio,
    specification: row.specification,
    variationMode: row.variationMode,
    consistency: row.consistency,
    inheritStyle: row.inheritStyle,
    inheritSeed: row.inheritSeed,
    params: row.params,
    status: row.status,
    error: row.error ?? row.taskJob?.error ?? null,
    costCredits: row.costCredits,
    taskJobId: row.taskJobId,
    taskJobStatus: row.taskJob?.status ?? null,
    gridImage: await serializeOptionalAsset(row.gridAsset ?? taskOutputAsset(row.taskJob)),
    candidates: await Promise.all(
      [...row.candidates].sort((a, b) => a.gridIndex - b.gridIndex).map(serializeCandidate),
    ),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function serializeCompositionTask(
  row: CompositionTaskWithRelations,
): Promise<CompositionTaskDTO> {
  const legacyTaskOutputAsset = taskOutputAsset(row.imageTask);
  const candidates = row.currentGridRun?.candidates ?? row.candidates;
  const [image, gridImage, candidateDTOs] = await Promise.all([
    serializeOptionalAsset(imageRunOutput(row.currentImageRun) ?? row.imageAsset ?? legacyTaskOutputAsset),
    serializeOptionalAsset(row.currentGridRun?.gridAsset ?? row.gridAsset ?? null),
    Promise.all([...candidates].sort((a, b) => a.gridIndex - b.gridIndex).map(serializeCandidate)),
  ]);
  const imageStatus = row.currentImageRun?.taskJob?.status ?? row.imageTask?.status ?? null;
  return {
    id: row.id,
    projectId: row.projectId,
    episodeId: row.episodeId,
    sceneIndex: row.sceneIndex,
    title: row.title,
    scriptExcerpt: row.scriptExcerpt,
    prompt: row.prompt,
    characterStyleIds: jsonStringArray(row.characterStyleIds),
    sceneIds: jsonStringArray(row.sceneIds),
    itemIds: jsonStringArray(row.itemIds),
    status: derivedStatus(row),
    error: row.error ??
      row.currentGridRun?.error ??
      row.currentGridRun?.taskJob?.error ??
      row.currentImageRun?.error ??
      row.currentImageRun?.taskJob?.error ??
      row.imageTask?.error ??
      null,
    currentImageRunId: row.currentImageRunId,
    currentGridRunId: row.currentGridRunId,
    image,
    imageTaskId: row.currentImageRun?.taskJobId ?? row.imageTaskId,
    imageTaskStatus: imageStatus,
    gridImage,
    candidates: candidateDTOs,
    imageRunCount: row._count?.imageRuns ?? 0,
    gridRunCount: row._count?.gridRuns ?? 0,
    candidateCount: row._count?.candidates ?? candidates.length,
    syncedAt: row.syncedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function serializeCompositionTaskRuns(
  row: {
    id: string;
    currentImageRunId: string | null;
    currentGridRunId: string | null;
    imageRuns: ImageRunWithRelations[];
    gridRuns: GridRunWithRelations[];
  },
): Promise<CompositionTaskRunsDTO> {
  return {
    taskId: row.id,
    currentImageRunId: row.currentImageRunId,
    currentGridRunId: row.currentGridRunId,
    imageRuns: await Promise.all(row.imageRuns.map(serializeCompositionImageRun)),
    gridRuns: await Promise.all(row.gridRuns.map(serializeCompositionGridRun)),
  };
}
