import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

export function getPrismaClient(opts?: ConstructorParameters<typeof PrismaClient>[0]): PrismaClient {
  if (!globalThis.__prismaClient) {
    globalThis.__prismaClient = new PrismaClient(opts);
  }
  return globalThis.__prismaClient;
}

export { PrismaClient };
export type {
  User, Project, Character, CharacterStyle, Item, Scene,
  StoryboardEpisode, KnowledgeDoc, Task, Asset, TaskAsset,
} from '@prisma/client';
