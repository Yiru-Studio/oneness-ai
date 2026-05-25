import {
  User,
  Project,
  KnowledgeDoc,
  Character,
  Item,
  Scene,
  ResourceImage,
  ResourceImageKind,
  StoryboardEpisode,
  Shot,
  CompositionTask,
  CompositionTaskRuns,
  AnalyticsData,
} from '@/types';
import { apiFetch, setAuthToken, ApiError } from './api-client';
import type { CreateProjectInput, UpdateProjectInput } from '@oneness/shared';

// -- Types received from backend ----------------------------------------

type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
type ProjectDTO = Project; // backend serializer matches the frontend Project shape
type CharacterDTO = Character;
type ItemDTO = Item;
type SceneDTO = Scene;
type ResourceImageDTO = ResourceImage;
type EpisodeDTO = StoryboardEpisode;
type CompositionTaskDTO = CompositionTask;
type CompositionTaskRunsDTO = CompositionTaskRuns;
type KnowledgeDocDTO = KnowledgeDoc;
type UserDTO = User;
type AnalyticsDTO = AnalyticsData;

// -- Auth ----------------------------------------------------------------

export async function getCurrentUser(): Promise<User | null> {
  try {
    return await apiFetch<UserDTO | null>('/api/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export async function login(email: string, code: string): Promise<{ token: string }> {
  const res = await apiFetch<{ token: string; user: UserDTO }>('/api/auth/login', {
    method: 'POST',
    body: { email, code },
  });
  setAuthToken(res.token);
  return { token: res.token };
}

export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/api/auth/logout', { method: 'POST' });
  } finally {
    setAuthToken(null);
  }
}

export async function updateProfile(data: Partial<User>): Promise<User> {
  const payload: { name?: string; email?: string } = {};
  if (data.name !== undefined) payload.name = data.name;
  if (data.email !== undefined) payload.email = data.email;
  return await apiFetch<UserDTO>('/api/me', { method: 'PATCH', body: payload });
}

// -- Projects -----------------------------------------------------------

export async function getProjects(search?: string): Promise<Project[]> {
  const res = await apiFetch<Paged<ProjectDTO>>('/api/projects', {
    query: { search },
  });
  return res.items;
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    return await apiFetch<ProjectDTO>(`/api/projects/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function createProject(data: CreateProjectInput): Promise<Project> {
  return await apiFetch<ProjectDTO>('/api/projects', { method: 'POST', body: data });
}

export async function updateProject(
  id: string,
  data: UpdateProjectInput,
): Promise<Project> {
  return await apiFetch<ProjectDTO>(`/api/projects/${id}`, {
    method: 'PATCH',
    body: data,
  });
}

export async function deleteProject(id: string): Promise<void> {
  await apiFetch<void>(`/api/projects/${id}`, { method: 'DELETE' });
}

// -- Project sub-resources ---------------------------------------------

export async function getProjectCharacters(projectId: string): Promise<Character[]> {
  return await apiFetch<CharacterDTO[]>(`/api/projects/${projectId}/characters`);
}

export async function createCharacter(
  projectId: string,
  data: { name: string; description?: string; bio?: string; voice?: string | null; avatarAssetId?: string | null; markedBlank?: boolean },
): Promise<Character> {
  return await apiFetch<CharacterDTO>(`/api/projects/${projectId}/characters`, {
    method: 'POST',
    body: data,
  });
}

export async function updateCharacter(
  characterId: string,
  data: Partial<{ name: string; description: string; bio: string; voice: string | null; avatarAssetId: string | null; avatarPrompt: string | null; markedBlank: boolean }>,
): Promise<Character> {
  return await apiFetch<CharacterDTO>(`/api/characters/${characterId}`, {
    method: 'PATCH',
    body: data,
  });
}

export async function deleteCharacter(characterId: string): Promise<void> {
  await apiFetch<void>(`/api/characters/${characterId}`, { method: 'DELETE' });
}

export async function analyzeCharacter(characterId: string): Promise<Character> {
  return await apiFetch<CharacterDTO>(`/api/characters/${characterId}/analyze`, {
    method: 'POST',
  });
}

export async function createCharacterStyle(
  characterId: string,
  data: {
    name: string;
    prompt?: string;
    model?: string | null;
    ratio?: string | null;
    assetId?: string | null;
  },
): Promise<{
  id: string;
  name: string;
  image: string;
  prompt: string;
  model: string | null;
  ratio: string | null;
  assetId: string | null;
}> {
  return await apiFetch(`/api/characters/${characterId}/styles`, {
    method: 'POST',
    body: data,
  });
}

export async function updateCharacterStyle(
  styleId: string,
  data: Partial<{
    name: string;
    prompt: string;
    model: string | null;
    ratio: string | null;
    assetId: string | null;
  }>,
): Promise<{
  id: string;
  name: string;
  image: string;
  prompt: string;
  model: string | null;
  ratio: string | null;
  assetId: string | null;
}> {
  return await apiFetch(`/api/character-styles/${styleId}`, {
    method: 'PATCH',
    body: data,
  });
}

export async function deleteCharacterStyle(styleId: string): Promise<void> {
  await apiFetch<void>(`/api/character-styles/${styleId}`, { method: 'DELETE' });
}

export async function getProjectItems(projectId: string): Promise<Item[]> {
  return await apiFetch<ItemDTO[]>(`/api/projects/${projectId}/items`);
}

export async function createItem(
  projectId: string,
  data: {
    name: string;
    description?: string;
    prompt?: string;
    model?: string | null;
    ratio?: string | null;
    assetId?: string | null;
  },
): Promise<Item> {
  return await apiFetch<ItemDTO>(`/api/projects/${projectId}/items`, {
    method: 'POST',
    body: data,
  });
}

export async function updateItem(
  itemId: string,
  data: Partial<{
    name: string;
    description: string;
    prompt: string;
    model: string | null;
    ratio: string | null;
    assetId: string | null;
  }>,
): Promise<Item> {
  return await apiFetch<ItemDTO>(`/api/items/${itemId}`, {
    method: 'PATCH',
    body: data,
  });
}

export async function deleteItem(itemId: string): Promise<void> {
  await apiFetch<void>(`/api/items/${itemId}`, { method: 'DELETE' });
}

export async function getProjectScenes(projectId: string): Promise<Scene[]> {
  return await apiFetch<SceneDTO[]>(`/api/projects/${projectId}/scenes`);
}

export async function createScene(
  projectId: string,
  data: {
    name: string;
    description?: string;
    prompt?: string;
    model?: string | null;
    ratio?: string | null;
    assetId?: string | null;
  },
): Promise<Scene> {
  return await apiFetch<SceneDTO>(`/api/projects/${projectId}/scenes`, {
    method: 'POST',
    body: data,
  });
}

export async function updateScene(
  sceneId: string,
  data: Partial<{
    name: string;
    description: string;
    prompt: string;
    model: string | null;
    ratio: string | null;
    assetId: string | null;
  }>,
): Promise<Scene> {
  return await apiFetch<SceneDTO>(`/api/scenes/${sceneId}`, {
    method: 'PATCH',
    body: data,
  });
}

export async function deleteScene(sceneId: string): Promise<void> {
  await apiFetch<void>(`/api/scenes/${sceneId}`, { method: 'DELETE' });
}

// -- Image-task helpers (chained: create task -> poll until done) ------

type CreateImageTaskInput = {
  prompt: string;
  ratio: string;
  model: string;
  referenceAssetIds?: string[];
  n?: number;
  characterId?: string;
};

type ResourceTargetInput = {
  kind: ResourceImageKind;
  entityId: string;
};

export type TaskDTO = {
  id: string;
  type: 'IMAGE' | 'VIDEO' | 'TEXT_ANALYZE';
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  output?: Record<string, unknown> | null;
  error?: string | null;
  outputAssets?: Array<{ id: string; url: string; contentType: string; sizeBytes: number; width: number | null; height: number | null }>;
};

export async function createImageTask(
  projectId: string,
  input: CreateImageTaskInput,
  provider: string = 'openai',
  resourceTarget?: ResourceTargetInput,
): Promise<TaskDTO> {
  return await apiFetch<TaskDTO>('/api/tasks', {
    method: 'POST',
    body: { type: 'IMAGE', projectId, provider, input, resourceTarget },
  });
}

export async function getTask(taskId: string): Promise<TaskDTO> {
  return await apiFetch<TaskDTO>(`/api/tasks/${taskId}`);
}

export async function pollTaskUntilDone(
  taskId: string,
  opts: { intervalMs?: number; timeoutMs?: number; onTick?: (t: TaskDTO) => void } = {},
): Promise<TaskDTO> {
  const interval = opts.intervalMs ?? 1500;
  const timeout = opts.timeoutMs ?? 5 * 60_000;
  const start = Date.now();
  while (true) {
    const t = await getTask(taskId);
    opts.onTick?.(t);
    if (t.status === 'SUCCEEDED' || t.status === 'FAILED' || t.status === 'CANCELLED') return t;
    if (Date.now() - start > timeout) throw new Error('task polling timeout');
    await new Promise((r) => setTimeout(r, interval));
  }
}

// -- Resource image history --------------------------------------------

export async function getResourceImages(
  kind: ResourceImageKind,
  entityId: string,
): Promise<ResourceImage[]> {
  return await apiFetch<ResourceImageDTO[]>('/api/resource-images', {
    query: { kind, entityId },
  });
}

export async function createResourceImage(data: {
  kind: ResourceImageKind;
  entityId: string;
  source?: 'generated' | 'upload' | 'legacy';
  status?: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  prompt?: string;
  model?: string | null;
  ratio?: string | null;
  assetId?: string | null;
  taskId?: string | null;
  error?: string | null;
  setAsCurrent?: boolean;
}): Promise<ResourceImage> {
  return await apiFetch<ResourceImageDTO>('/api/resource-images', {
    method: 'POST',
    body: data,
  });
}

export async function updateResourceImage(
  id: string,
  data: Partial<{
    status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
    prompt: string;
    model: string | null;
    ratio: string | null;
    assetId: string | null;
    taskId: string | null;
    error: string | null;
    setAsCurrent: boolean;
  }>,
): Promise<ResourceImage> {
  return await apiFetch<ResourceImageDTO>(`/api/resource-images/${id}`, {
    method: 'PATCH',
    body: data,
  });
}

export async function getProjectStoryboard(
  projectId: string,
): Promise<StoryboardEpisode[]> {
  return await apiFetch<EpisodeDTO[]>(`/api/projects/${projectId}/episodes`);
}

export async function createEpisode(
  projectId: string,
  data: { number: number; title: string; content: string },
): Promise<StoryboardEpisode> {
  return await apiFetch<EpisodeDTO>(`/api/projects/${projectId}/episodes`, {
    method: 'POST',
    body: data,
  });
}

export async function updateEpisode(
  episodeId: string,
  data: Partial<{ number: number; title: string; content: string }>,
): Promise<StoryboardEpisode> {
  return await apiFetch<EpisodeDTO>(`/api/episodes/${episodeId}`, {
    method: 'PATCH',
    body: data,
  });
}

export async function deleteEpisode(episodeId: string): Promise<void> {
  await apiFetch<void>(`/api/episodes/${episodeId}`, { method: 'DELETE' });
}

// -- Shots --------------------------------------------------------------

type ShotDTO = Shot;

export async function getEpisodeShots(
  projectId: string,
  episodeId: string,
): Promise<Shot[]> {
  return await apiFetch<ShotDTO[]>(
    `/api/projects/${projectId}/episodes/${episodeId}/shots`,
  );
}

export type CreateShotInput = {
  afterDisplayId?: number;
  sceneIndex?: number;
  shotType?: 'new' | 'continuation';
  preId?: number;
  duration?: number;
  prompt?: string;
  model?: string;
  ratio?: string;
  resolution?: string;
  generateAudio?: boolean;
  characterStyleIds?: string[];
  sceneIds?: string[];
  itemIds?: string[];
};

export async function createShot(
  projectId: string,
  episodeId: string,
  body: CreateShotInput,
): Promise<Shot> {
  return await apiFetch<ShotDTO>(
    `/api/projects/${projectId}/episodes/${episodeId}/shots`,
    { method: 'POST', body },
  );
}

export type UpdateShotInput = Partial<{
  shotType: 'new' | 'continuation';
  preId: number | null;
  duration: number;
  prompt: string;
  model: string;
  ratio: string;
  resolution: string;
  generateAudio: boolean;
  sketchAssetId: string | null;
  characterStyleIds: string[];
  sceneIds: string[];
  itemIds: string[];
}>;

export async function updateShot(shotId: string, body: UpdateShotInput): Promise<Shot> {
  return await apiFetch<ShotDTO>(`/api/shots/${shotId}`, {
    method: 'PATCH',
    body,
  });
}

export async function deleteShot(shotId: string): Promise<void> {
  await apiFetch<void>(`/api/shots/${shotId}`, { method: 'DELETE' });
}

export async function generateShotVideo(shotId: string): Promise<Shot> {
  return await apiFetch<ShotDTO>(`/api/shots/${shotId}/generate-video`, {
    method: 'POST',
    body: {},
  });
}

export type TaskSummary = {
  id: string;
  type: 'IMAGE' | 'VIDEO' | 'TEXT_ANALYZE';
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  input?: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  error?: string | null;
};

export async function analyzeEpisode(
  projectId: string,
  episodeId: string,
): Promise<{ tasks: TaskSummary[] }> {
  return await apiFetch<{ tasks: TaskSummary[] }>(
    `/api/projects/${projectId}/episodes/${episodeId}/analyze`,
    { method: 'POST', body: {} },
  );
}

/**
 * likeai's "分析剧集": kicks off a TEXT_ANALYZE task that breaks the episode
 * into scenes (summary + scenes[]) and flips `analyzed` when it completes.
 * Returns the task; poll it with {@link pollTaskUntilDone}, then re-fetch the
 * episode. Distinct from {@link analyzeEpisode}, which fans out project-level
 * character / item / scene extraction.
 */
export async function analyzeEpisodeForStoryboard(
  projectId: string,
  episodeId: string,
): Promise<TaskDTO> {
  const res = await apiFetch<{ task: TaskDTO }>(
    `/api/projects/${projectId}/episodes/${episodeId}/analyze-storyboard`,
    { method: 'POST', body: {} },
  );
  return res.task;
}

/**
 * likeai's AI-assist "智能分镜创作": kicks off a TEXT_ANALYZE task that breaks
 * one analyzed scene into a shot list and creates the Shot rows. Returns the
 * task; poll it, then re-fetch the episode's shots.
 */
export async function generateSceneShots(
  projectId: string,
  episodeId: string,
  sceneIndex: number,
): Promise<TaskDTO> {
  const res = await apiFetch<{ task: TaskDTO }>(
    `/api/projects/${projectId}/episodes/${episodeId}/generate-shots`,
    { method: 'POST', body: { sceneIndex } },
  );
  return res.task;
}

export type GenerateShotSketchesResult = {
  compositionTaskId: string;
  createdTaskIds: string[];
  targetShotIds: string[];
  skippedShotIds: string[];
  createdCount: number;
  skippedCount: number;
};

export async function generateShotSketches(
  projectId: string,
  body: { episodeId: string; sceneIndex: number; force?: boolean },
): Promise<GenerateShotSketchesResult> {
  return await apiFetch<GenerateShotSketchesResult>(
    `/api/projects/${projectId}/composition-tasks/generate-shot-sketches`,
    { method: 'POST', body },
  );
}

// -- Composition shots --------------------------------------------------

export async function getCompositionTasks(projectId: string): Promise<CompositionTask[]> {
  return await apiFetch<CompositionTaskDTO[]>(`/api/projects/${projectId}/composition-tasks`);
}

export async function analyzeCompositionTasks(
  projectId: string,
  body: { episodeId?: string } = {},
): Promise<CompositionTask[]> {
  return await apiFetch<CompositionTaskDTO[]>(
    `/api/projects/${projectId}/composition-tasks/analyze`,
    { method: 'POST', body },
  );
}

export async function updateCompositionTask(
  taskId: string,
  body: Partial<{
    prompt: string;
    characterStyleIds: string[];
    sceneIds: string[];
    itemIds: string[];
    selectedCandidateIds: string[];
  }>,
): Promise<CompositionTask> {
  return await apiFetch<CompositionTaskDTO>(`/api/composition-tasks/${taskId}`, {
    method: 'PATCH',
    body,
  });
}

export type CompositionImageGenerationSettings = Partial<{
  model: string;
  ratio: string;
  quality: '1080p' | '2k' | '4k';
  outputCount: number;
  seed: string | null;
  characterConsistency: number;
  sceneConsistency: number;
  itemConsistency: number;
  negativePrompt: string;
}>;

export type CompositionGridGenerationSettings = Partial<{
  model: string;
  ratio: string;
  specification: '3x3';
  variationMode: 'auto_angles' | 'fixed_angles';
  consistency: number;
  inheritStyle: boolean;
  inheritSeed: boolean;
}>;

export type ApplyCompositionMode =
  | 'create_shots'
  | 'replace_existing_shots'
  | 'add_to_storyboard_assets';

export async function getCompositionTaskRuns(taskId: string): Promise<CompositionTaskRuns> {
  return await apiFetch<CompositionTaskRunsDTO>(`/api/composition-tasks/${taskId}/runs`);
}

export async function generateCompositionImage(
  taskId: string,
  body: CompositionImageGenerationSettings = {},
): Promise<CompositionTask> {
  return await apiFetch<CompositionTaskDTO>(`/api/composition-tasks/${taskId}/generate-image`, {
    method: 'POST',
    body,
  });
}

export async function setCurrentCompositionImageRun(runId: string): Promise<CompositionTask> {
  return await apiFetch<CompositionTaskDTO>(`/api/composition-image-runs/${runId}/set-current`, {
    method: 'POST',
    body: {},
  });
}

export async function generateCompositionGrid(
  imageRunId: string,
  body: CompositionGridGenerationSettings = {},
): Promise<CompositionTask> {
  return await apiFetch<CompositionTaskDTO>(`/api/composition-image-runs/${imageRunId}/generate-grid`, {
    method: 'POST',
    body,
  });
}

export async function setCurrentCompositionGridRun(runId: string): Promise<CompositionTask> {
  return await apiFetch<CompositionTaskDTO>(`/api/composition-grid-runs/${runId}/set-current`, {
    method: 'POST',
    body: {},
  });
}

export async function applyCompositionGridToShots(
  gridRunId: string,
  body: {
    candidateIds: string[];
    mode: ApplyCompositionMode;
    targetShotIds?: string[];
  },
): Promise<CompositionTask> {
  return await apiFetch<CompositionTaskDTO>(`/api/composition-grid-runs/${gridRunId}/apply-to-shots`, {
    method: 'POST',
    body,
  });
}

export async function getProjectAnalytics(projectId: string): Promise<AnalyticsData> {
  return await apiFetch<AnalyticsDTO>(`/api/projects/${projectId}/analytics`);
}

// -- Knowledge docs -----------------------------------------------------

export async function getKnowledgeDocs(type: string): Promise<KnowledgeDoc[]> {
  // Backend expects uppercase enum; current callers pass 'created'/'favorited'/'collaborated'
  const upper = type.toUpperCase();
  const res = await apiFetch<Paged<KnowledgeDocDTO>>('/api/knowledge-docs', {
    query: { type: upper },
  });
  return res.items;
}

// -- Asset upload (helper for future avatar/style uploads) -------------

export type AssetDTO = {
  id: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

export async function uploadAsset(file: File): Promise<AssetDTO> {
  const fd = new FormData();
  fd.append('file', file);
  return await apiFetch<AssetDTO>('/api/assets', { method: 'POST', formData: fd });
}

export async function deleteAsset(id: string): Promise<void> {
  await apiFetch<void>(`/api/assets/${id}`, { method: 'DELETE' });
}

// -- Re-export for callers that want to introspect errors -------------

export { ApiError };
