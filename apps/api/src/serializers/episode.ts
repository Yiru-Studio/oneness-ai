import type { StoryboardEpisode } from '@oneness/shared/prisma';

export type EpisodeScene = {
  index: number;
  title: string;
  content: string;
  characters: string[];
  environment: string;
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

function parseScenes(v: unknown): EpisodeScene[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s, i) => ({
      index: typeof s.index === 'number' ? s.index : i,
      title: typeof s.title === 'string' ? s.title : '',
      content: typeof s.content === 'string' ? s.content : '',
      characters: Array.isArray(s.characters)
        ? s.characters.filter((x): x is string => typeof x === 'string')
        : [],
      environment: typeof s.environment === 'string' ? s.environment : '',
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
