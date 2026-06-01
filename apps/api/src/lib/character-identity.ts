import type { Prisma } from '@prisma/client';
import type { PrismaClient } from '@oneness/shared/prisma';

type Db = PrismaClient | Prisma.TransactionClient;

export type CharacterIdentityReference = {
  characterId: string;
  assetId: string;
  source: 'identity' | 'avatar';
};

export async function resolveCharacterIdentityReference(
  db: Db,
  characterId: string,
  userId: string,
): Promise<CharacterIdentityReference | null> {
  const character = await db.character.findFirst({
    where: { id: characterId, project: { ownerId: userId } },
    select: { id: true, identityAssetId: true, avatarAssetId: true },
  });
  if (!character) return null;
  const assetId = character.identityAssetId ?? character.avatarAssetId ?? null;
  if (!assetId) return null;
  return {
    characterId: character.id,
    assetId,
    source: character.identityAssetId ? 'identity' : 'avatar',
  };
}

export async function resolveStyleIdentityReference(
  db: Db,
  styleId: string,
  userId: string,
): Promise<CharacterIdentityReference | null> {
  const style = await db.characterStyle.findFirst({
    where: { id: styleId, character: { project: { ownerId: userId } } },
    select: {
      character: { select: { id: true, identityAssetId: true, avatarAssetId: true } },
    },
  });
  if (!style) return null;
  const assetId = style.character.identityAssetId ?? style.character.avatarAssetId ?? null;
  if (!assetId) return null;
  return {
    characterId: style.character.id,
    assetId,
    source: style.character.identityAssetId ? 'identity' : 'avatar',
  };
}

export function prependIdentityReference(
  referenceAssetIds: unknown,
  identityAssetId: string,
): string[] {
  const existing = Array.isArray(referenceAssetIds)
    ? referenceAssetIds.filter((id): id is string => typeof id === 'string')
    : [];
  return [identityAssetId, ...existing.filter((id) => id !== identityAssetId)].slice(0, 8);
}

export function uniqueAssetIds(ids: Array<string | null | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}
