import { User, Project, KnowledgeDoc, ProjectTabContent, Character, Item, Scene, StoryboardEpisode, AnalyticsData } from '@/types';
import { mockUser, mockProjects, mockKnowledgeDocs, mockCharacters, mockItems, mockScenes, mockStoryboardEpisodes, mockAnalytics } from '@/data/mock';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function getCurrentUser(): Promise<User | null> {
  await delay(300);
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { ...mockUser } : null;
}

export async function login(email: string, _code: string): Promise<{ token: string }> {
  await delay(500);
  const token = 'mock_token_' + Date.now();
  if (typeof window !== 'undefined') {
    localStorage.setItem('auth_token', token);
  }
  return { token };
}

export async function logout(): Promise<void> {
  await delay(200);
  if (typeof window !== 'undefined') {
    localStorage.removeItem('auth_token');
  }
}

export async function updateProfile(data: Partial<User>): Promise<User> {
  await delay(300);
  return { ...mockUser, ...data };
}

export async function getProjects(search?: string): Promise<Project[]> {
  await delay(300);
  let projects = [...mockProjects];
  if (search) {
    projects = projects.filter(p => p.name.includes(search));
  }
  return projects;
}

export async function getProject(id: string): Promise<Project | null> {
  await delay(300);
  return mockProjects.find(p => p.id === id) || null;
}

export async function createProject(data: Omit<Project, 'id' | 'createdAt'>): Promise<Project> {
  await delay(500);
  return {
    ...data,
    id: 'proj_' + Date.now(),
    createdAt: new Date().toISOString(),
  };
}

export async function deleteProject(_id: string): Promise<void> {
  await delay(300);
}

export async function getProjectTabContent(
  _projectId: string,
  tab: string
): Promise<ProjectTabContent> {
  await delay(400);
  return {
    tab: tab as ProjectTabContent['tab'],
    content: '',
  };
}

export async function getProjectCharacters(_projectId: string): Promise<Character[]> {
  await delay(300);
  return [...mockCharacters];
}

export async function getProjectItems(_projectId: string): Promise<Item[]> {
  await delay(300);
  return [...mockItems];
}

export async function getProjectScenes(_projectId: string): Promise<Scene[]> {
  await delay(300);
  return [...mockScenes];
}

export async function getProjectStoryboard(_projectId: string): Promise<StoryboardEpisode[]> {
  await delay(300);
  return [...mockStoryboardEpisodes];
}

export async function getProjectAnalytics(_projectId: string): Promise<AnalyticsData> {
  await delay(300);
  return { ...mockAnalytics };
}

export async function getKnowledgeDocs(type: string): Promise<KnowledgeDoc[]> {
  await delay(300);
  return mockKnowledgeDocs.filter(d => d.type === type);
}
