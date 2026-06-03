import type { StoryboardEpisode } from '@oneness/shared/prisma';

export type EpisodeScene = {
  index: number;
  title: string;
  content: string;
  characters: string[];
  environment: string;
  sceneReferences?: {
    visibleCharacters: string[];
    mentionedCharacters: string[];
    voiceCharacters: string[];
    backgroundCharacters: string[];
    visibleItems: string[];
    mentionedItems: string[];
    backgroundItems: string[];
  };
};

export type EpisodeDTO = {
  id: string;
  number: number;
  title: string;
  content: string;
  analyzed: boolean;
  summary: string;
  scenes: EpisodeScene[];
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

function parseSceneReferences(value: unknown): EpisodeScene['sceneReferences'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  return {
    visibleCharacters: stringArray(obj.visibleCharacters),
    mentionedCharacters: stringArray(obj.mentionedCharacters),
    voiceCharacters: stringArray(obj.voiceCharacters),
    backgroundCharacters: stringArray(obj.backgroundCharacters),
    visibleItems: stringArray(obj.visibleItems),
    mentionedItems: stringArray(obj.mentionedItems),
    backgroundItems: stringArray(obj.backgroundItems),
  };
}

function parseScenes(v: unknown): EpisodeScene[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s, i) => ({
      index: typeof s.index === 'number' ? s.index : i,
      title: typeof s.title === 'string' ? s.title : '',
      content: typeof s.content === 'string' ? s.content : '',
      characters: stringArray(s.characters),
      environment: typeof s.environment === 'string' ? s.environment : '',
      sceneReferences: parseSceneReferences(s.sceneReferences),
    }));
}

export function serializeEpisode(e: StoryboardEpisode): EpisodeDTO {
  return {
    id: e.id,
    number: e.number,
    title: e.title,
    content: e.content,
    analyzed: e.analyzed,
    summary: e.summary,
    scenes: parseScenes(e.scenesJson),
  };
}
