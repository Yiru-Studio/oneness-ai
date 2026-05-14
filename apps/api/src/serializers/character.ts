import type { Character, CharacterStyle, Asset } from '@oneness/shared/prisma';
import { Buckets } from '../lib/minio.js';
import { presignGet, presignKey } from '../lib/assets.js';

export type CharacterStyleDTO = { id: string; name: string; image: string };
export type CharacterDTO = {
  id: string;
  name: string;
  avatar: string;
  description: string;
  bio: string;
  voice?: string;
  styles: CharacterStyleDTO[];
};

type StyleWithAsset = CharacterStyle & { asset: Asset | null };
type CharacterWithStyles = Character & { styles: StyleWithAsset[] };

export async function serializeCharacter(c: CharacterWithStyles): Promise<CharacterDTO> {
  const avatar = (await presignKey(Buckets.USER_UPLOADS, c.avatarKey)) ?? '';
  const styles = await Promise.all(
    c.styles.map(async (s) => ({
      id: s.id,
      name: s.name,
      image: s.asset ? await presignGet(s.asset.bucket, s.asset.key) : '',
    })),
  );
  return {
    id: c.id,
    name: c.name,
    avatar,
    description: c.description,
    bio: c.bio,
    voice: c.voice ?? '',
    styles,
  };
}
