import type { Item, Asset } from '@oneness/shared/prisma';
import { presignGet } from '../lib/assets.js';

export type ItemDTO = { id: string; name: string; image: string };

type ItemWithAsset = Item & { asset: Asset | null };

export async function serializeItem(item: ItemWithAsset): Promise<ItemDTO> {
  return {
    id: item.id,
    name: item.name,
    image: item.asset ? await presignGet(item.asset.bucket, item.asset.key) : '',
  };
}
