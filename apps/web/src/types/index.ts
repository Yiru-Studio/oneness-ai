export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  credits: number;
}

export interface Project {
  id: string;
  name: string;
  ratio: string;
  style: string;
  createdAt: string;
  stylePrompt: string;
  analysisModel: string;
  imageModel: string;
  videoModel: string;
  generalAnalysis: 'pending' | 'completed';
  basicAnalysis: 'pending' | 'completed';
}

export type ProjectTab = 'info' | 'characters' | 'items' | 'scenes' | 'workbench' | 'storyboard' | 'analytics';

export interface ProjectTabContent {
  tab: ProjectTab;
  content: string;
}

export interface Character {
  id: string;
  name: string;
  avatar: string;
  avatarAssetId?: string | null;
  description: string;
  bio: string;
  voice?: string;
  avatarPrompt?: string | null;
  markedBlank?: boolean;
  styles: Array<{
    id?: string;
    name: string;
    image: string;
    prompt?: string;
    model?: string | null;
    ratio?: string | null;
    assetId?: string | null;
  }>;
}

export interface Item {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  model?: string | null;
  ratio?: string | null;
  assetId?: string | null;
  image: string;
}

export interface Scene {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  model?: string | null;
  ratio?: string | null;
  assetId?: string | null;
  image: string;
}

export type ResourceImageKind = 'character-style' | 'scene' | 'item';
export type ResourceImageStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface ResourceImage {
  id: string;
  kind: ResourceImageKind;
  entityId: string | null;
  source: 'generated' | 'upload' | 'legacy';
  status: ResourceImageStatus;
  prompt: string;
  model: string | null;
  ratio: string | null;
  error: string | null;
  assetId: string | null;
  taskId: string | null;
  image: string;
  taskStatus: ResourceImageStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface EpisodeScene {
  index: number;
  title: string;
  content: string;
  characters: string[];
  environment: string;
}

export interface StoryboardEpisode {
  id: string;
  number: number;
  title: string;
  content: string;
  analyzed: boolean;
  summary: string;
  scenes: EpisodeScene[];
}

export interface ShotAssetRef {
  id: string;
  url: string;
  contentType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export type ShotType = 'new' | 'continuation';
export type ShotCreateType = 'manual' | 'assist';
export type ShotVideoTaskStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface Shot {
  id: string;
  episodeId: string;
  displayId: number;
  shotType: ShotType;
  preId: number | null;
  duration: number;
  prompt: string;
  model: string;
  ratio: string;
  resolution: string;
  generateAudio: boolean;
  createType: ShotCreateType;
  sceneIndex: number;
  sketch: ShotAssetRef | null;
  video: ShotAssetRef | null;
  lastFrame: ShotAssetRef | null;
  videoTaskId: string | null;
  videoTaskStatus: ShotVideoTaskStatus | null;
  characterStyleIds: string[];
  sceneIds: string[];
  itemIds: string[];
  roleNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AnalyticsData {
  totalCredits: number;
  imageCount: number;
  videoCount: number;
  textTaskCount: number;
  updateTime: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  type: 'created' | 'favorited' | 'collaborated';
  content?: string;
  createdAt: string;
}

export type Language = 'zh-CN' | 'en' | 'zh-TW' | 'ja' | 'ko' | 'es' | 'fr' | 'de';

export interface LanguageOption {
  value: Language;
  label: string;
}
