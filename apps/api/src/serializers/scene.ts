import type { Scene, Asset, ResourceImage, Task } from '@oneness/shared/prisma';
import { presignGet } from '../lib/assets.js';
import { serializeResourceImage, type ResourceImageDTO } from './resource-image.js';

export type SceneDTO = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  model: string | null;
  ratio: string | null;
  image: string;
  assetId: string | null;
  sceneResourceImage: ResourceImageDTO | null;
};

type ResourceImageWithRelations = ResourceImage & {
  asset: Asset | null;
  task: Task | null;
};
type SceneWithAsset = Scene & {
  asset: Asset | null;
  resourceImages?: ResourceImageWithRelations[];
};

export async function serializeScene(s: SceneWithAsset): Promise<SceneDTO> {
  const sceneResourceImage = s.resourceImages?.[0]
    ? await serializeResourceImage(s.resourceImages[0])
    : null;
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? '',
    prompt: s.prompt ?? '',
    model: s.model ?? null,
    ratio: s.ratio ?? null,
    image: s.asset ? await presignGet(s.asset.bucket, s.asset.key) : '',
    assetId: s.assetId ?? null,
    sceneResourceImage,
  };
}
