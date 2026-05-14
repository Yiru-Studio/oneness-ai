import type { Scene, Asset } from '@oneness/shared/prisma';
import { presignGet } from '../lib/assets.js';

export type SceneDTO = { id: string; name: string; image: string };

type SceneWithAsset = Scene & { asset: Asset | null };

export async function serializeScene(s: SceneWithAsset): Promise<SceneDTO> {
  return {
    id: s.id,
    name: s.name,
    image: s.asset ? await presignGet(s.asset.bucket, s.asset.key) : '',
  };
}
