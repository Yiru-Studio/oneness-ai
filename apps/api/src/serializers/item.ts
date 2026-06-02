import type { Item, Asset, ResourceImage, Task } from '@oneness/shared/prisma';
import { presignGet } from '../lib/assets.js';
import { serializeResourceImage, type ResourceImageDTO } from './resource-image.js';

export type ItemDTO = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  model: string | null;
  ratio: string | null;
  image: string;
  assetId: string | null;
  itemResourceImage: ResourceImageDTO | null;
};

type ResourceImageWithRelations = ResourceImage & {
  asset: Asset | null;
  task: Task | null;
};
type ItemWithAsset = Item & {
  asset: Asset | null;
  resourceImages?: ResourceImageWithRelations[];
};

export async function serializeItem(item: ItemWithAsset): Promise<ItemDTO> {
  const itemResourceImage = item.resourceImages?.[0]
    ? await serializeResourceImage(item.resourceImages[0])
    : null;
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    prompt: item.prompt ?? '',
    model: item.model ?? null,
    ratio: item.ratio ?? null,
    image: item.asset ? await presignGet(item.asset.bucket, item.asset.key) : '',
    assetId: item.assetId ?? null,
    itemResourceImage,
  };
}
