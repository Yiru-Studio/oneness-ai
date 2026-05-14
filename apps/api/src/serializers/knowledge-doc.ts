import type { KnowledgeDoc } from '@oneness/shared/prisma';

export type KnowledgeDocDTO = {
  id: string;
  title: string;
  type: 'created' | 'favorited' | 'collaborated';
  content?: string;
  createdAt: string;
};

export function serializeKnowledgeDoc(d: KnowledgeDoc): KnowledgeDocDTO {
  return {
    id: d.id,
    title: d.title,
    type: d.type.toLowerCase() as 'created' | 'favorited' | 'collaborated',
    content: d.content ?? undefined,
    createdAt: d.createdAt.toISOString(),
  };
}
