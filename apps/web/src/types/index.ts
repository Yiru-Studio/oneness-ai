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
  markedBlank?: boolean;
  styles: Array<{
    id?: string;
    name: string;
    image: string;
  }>;
}

export interface Item {
  id: string;
  name: string;
  image: string;
}

export interface Scene {
  id: string;
  name: string;
  image: string;
}

export interface StoryboardEpisode {
  id: string;
  number: number;
  title: string;
  content: string;
  analyzed: boolean;
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
