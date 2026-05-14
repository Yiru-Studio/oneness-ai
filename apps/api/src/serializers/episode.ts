import type { StoryboardEpisode } from '@oneness/shared/prisma';

export type EpisodeDTO = {
  id: string;
  number: number;
  title: string;
  content: string;
  analyzed: boolean;
};

export function serializeEpisode(e: StoryboardEpisode): EpisodeDTO {
  return {
    id: e.id,
    number: e.number,
    title: e.title,
    content: e.content,
    analyzed: e.analyzed,
  };
}
