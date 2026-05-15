import type { Scene, Asset } from '@oneness/shared/prisma';
import { presignGet } from '../lib/assets.js';

export type SceneDTO = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  model: string | null;
  ratio: string | null;
  image: string;
  assetId: string | null;
};

type SceneWithAsset = Scene & { asset: Asset | null };

export async function serializeScene(s: SceneWithAsset): Promise<SceneDTO> {
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? '',
    prompt: s.prompt ?? '',
    model: s.model ?? null,
    ratio: s.ratio ?? null,
    image: s.asset ? await presignGet(s.asset.bucket, s.asset.key) : '',
    assetId: s.assetId ?? null,
  };
}
