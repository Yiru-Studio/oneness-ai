import type { Character, CharacterStyle, Asset, ResourceImage, Task } from '@oneness/shared/prisma';
import { presignGet } from '../lib/assets.js';
import { serializeResourceImage, type ResourceImageDTO } from './resource-image.js';

export type CharacterStyleDTO = {
  id: string;
  name: string;
  image: string;
  prompt: string;
  model: string | null;
  ratio: string | null;
  assetId: string | null;
};
export type CharacterDTO = {
  id: string;
  name: string;
  avatar: string;
  avatarAssetId: string | null;
  identityAssetId: string | null;
  description: string;
  bio: string;
  voice?: string;
  markedBlank: boolean;
  avatarPrompt: string | null;
  avatarResourceImage: ResourceImageDTO | null;
  styles: CharacterStyleDTO[];
};

type StyleWithAsset = CharacterStyle & { asset: Asset | null };
type ResourceImageWithRelations = ResourceImage & {
  asset: Asset | null;
  task: Task | null;
};
type CharacterWithStyles = Character & {
  styles: StyleWithAsset[];
  avatar?: Asset | null;
  resourceImages?: ResourceImageWithRelations[];
};

export async function serializeCharacter(c: CharacterWithStyles): Promise<CharacterDTO> {
  const avatar = c.avatar ? await presignGet(c.avatar.bucket, c.avatar.key) : '';
  const styles = await Promise.all(
    c.styles.map(async (s) => ({
      id: s.id,
      name: s.name,
      image: s.asset ? await presignGet(s.asset.bucket, s.asset.key) : '',
      prompt: s.prompt ?? '',
      model: s.model ?? null,
      ratio: s.ratio ?? null,
      assetId: s.assetId ?? null,
    })),
  );
  const avatarResourceImage = c.resourceImages?.[0]
    ? await serializeResourceImage(c.resourceImages[0])
    : null;
  return {
    id: c.id,
    name: c.name,
    avatar,
    avatarAssetId: c.avatarAssetId ?? null,
    identityAssetId: c.identityAssetId ?? null,
    description: c.description,
    bio: c.bio,
    voice: c.voice ?? '',
    markedBlank: c.markedBlank ?? false,
    avatarPrompt: c.avatarPrompt ?? null,
    avatarResourceImage,
    styles,
  };
}
