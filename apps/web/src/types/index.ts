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
  analysisStarted: boolean;
  analysisState: 'idle' | 'running' | 'failed' | 'completed';
  analysisSubjects: {
    characters: 'idle' | 'running' | 'failed' | 'completed';
    scenes: 'idle' | 'running' | 'failed' | 'completed';
    items: 'idle' | 'running' | 'failed' | 'completed';
  };
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
  identityAssetId?: string | null;
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
    styleResourceImage?: ResourceImage | null;
  }>;
  avatarResourceImage?: ResourceImage | null;
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
  itemResourceImage?: ResourceImage | null;
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
  sceneResourceImage?: ResourceImage | null;
}

export type ResourceImageKind = 'character-avatar' | 'character-style' | 'scene' | 'item';
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
  identityReferenceAssetId?: string | null;
  referenceAssetIds?: string[];
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
  sketchTaskId: string | null;
  sketchTaskStatus: ShotVideoTaskStatus | null;
  videoTaskId: string | null;
  videoTaskStatus: ShotVideoTaskStatus | null;
  characterStyleIds: string[];
  sceneIds: string[];
  itemIds: string[];
  compositionTaskIds: string[];
  roleNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CompositionCandidate {
  id: string;
  taskId: string;
  gridRunId: string | null;
  gridIndex: number;
  angleLabel: string | null;
  image: ShotAssetRef | null;
  selected: boolean;
  syncedShotId: string | null;
  status: 'READY' | 'APPLIED' | 'SYNCED' | string;
  appliedMode: 'create_shots' | 'replace_existing_shots' | 'add_to_storyboard_assets' | string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompositionImageRun {
  id: string;
  taskId: string;
  prompt: string;
  negativePrompt: string;
  model: string;
  ratio: string;
  quality: '1080p' | '2k' | '4k' | 'standard' | 'hd' | string;
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
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | string;
  error: string | null;
  costCredits: number;
  taskJobId: string | null;
  taskJobStatus: ShotVideoTaskStatus | null;
  image: ShotAssetRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompositionGridRun {
  id: string;
  taskId: string;
  imageRunId: string;
  model: string;
  ratio: string;
  specification: '3x3' | string;
  variationMode: 'auto_angles' | 'fixed_angles' | string;
  consistency: number;
  inheritStyle: boolean;
  inheritSeed: boolean;
  params: unknown;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED' | string;
  error: string | null;
  costCredits: number;
  taskJobId: string | null;
  taskJobStatus: ShotVideoTaskStatus | null;
  gridImage: ShotAssetRef | null;
  candidates: CompositionCandidate[];
  createdAt: string;
  updatedAt: string;
}

export interface CompositionTaskRuns {
  taskId: string;
  currentImageRunId: string | null;
  currentGridRunId: string | null;
  imageRuns: CompositionImageRun[];
  gridRuns: CompositionGridRun[];
}

export interface CompositionTask {
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
  status:
    | 'DRAFT'
    | 'IMAGE_QUEUED'
    | 'IMAGE_RUNNING'
    | 'IMAGE_READY'
    | 'IMAGE_FAILED'
    | 'GRID_QUEUED'
    | 'GRID_RUNNING'
    | 'GRID_READY'
    | 'GRID_FAILED'
    | 'APPLIED'
    | 'SYNCED'
    | string;
  error: string | null;
  currentImageRunId: string | null;
  currentGridRunId: string | null;
  image: ShotAssetRef | null;
  imageTaskId: string | null;
  imageTaskStatus: ShotVideoTaskStatus | null;
  gridImage: ShotAssetRef | null;
  candidates: CompositionCandidate[];
  imageRunCount: number;
  gridRunCount: number;
  candidateCount: number;
  syncedAt: string | null;
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
