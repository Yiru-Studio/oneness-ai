import {
  User,
  Project,
  KnowledgeDoc,
  Character,
  Item,
  Scene,
  StoryboardEpisode,
  AnalyticsData,
} from '@/types';
import { apiFetch, setAuthToken, ApiError } from './api-client';

// -- Types received from backend ----------------------------------------

type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };
type ProjectDTO = Project; // backend serializer matches the frontend Project shape
type CharacterDTO = Character;
type ItemDTO = Item;
type SceneDTO = Scene;
type EpisodeDTO = StoryboardEpisode;
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

export async function createProject(
  data: Omit<Project, 'id' | 'createdAt'>,
): Promise<Project> {
  return await apiFetch<ProjectDTO>('/api/projects', { method: 'POST', body: data });
}

export async function deleteProject(id: string): Promise<void> {
  await apiFetch<void>(`/api/projects/${id}`, { method: 'DELETE' });
}

// -- Project sub-resources ---------------------------------------------

export async function getProjectCharacters(projectId: string): Promise<Character[]> {
  return await apiFetch<CharacterDTO[]>(`/api/projects/${projectId}/characters`);
}

export async function getProjectItems(projectId: string): Promise<Item[]> {
  return await apiFetch<ItemDTO[]>(`/api/projects/${projectId}/items`);
}

export async function getProjectScenes(projectId: string): Promise<Scene[]> {
  return await apiFetch<SceneDTO[]>(`/api/projects/${projectId}/scenes`);
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
