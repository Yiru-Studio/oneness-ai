import type { Character, CharacterStyle, Asset } from '@oneness/shared/prisma';
import { presignGet } from '../lib/assets.js';

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
  description: string;
  bio: string;
  voice?: string;
  markedBlank: boolean;
  avatarPrompt: string | null;
  styles: CharacterStyleDTO[];
};

type StyleWithAsset = CharacterStyle & { asset: Asset | null };
type CharacterWithStyles = Character & {
  styles: StyleWithAsset[];
  avatar?: Asset | null;
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
  return {
    id: c.id,
    name: c.name,
    avatar,
    avatarAssetId: c.avatarAssetId ?? null,
    description: c.description,
    bio: c.bio,
    voice: c.voice ?? '',
    markedBlank: c.markedBlank ?? false,
    avatarPrompt: c.avatarPrompt ?? null,
    styles,
  };
}
