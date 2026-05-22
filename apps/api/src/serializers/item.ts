import type { Item, Asset } from '@oneness/shared/prisma';
import { presignGet } from '../lib/assets.js';

export type ItemDTO = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  model: string | null;
  ratio: string | null;
  image: string;
  assetId: string | null;
  reviewStatus: string;
  promptStatus: string;
  promptTaskId: string | null;
  promptError: string | null;
};

type ItemWithAsset = Item & { asset: Asset | null };

export async function serializeItem(item: ItemWithAsset): Promise<ItemDTO> {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    prompt: item.prompt ?? '',
    model: item.model ?? null,
    ratio: item.ratio ?? null,
    image: item.asset ? await presignGet(item.asset.bucket, item.asset.key) : '',
    assetId: item.assetId ?? null,
    reviewStatus: item.reviewStatus,
    promptStatus: item.promptStatus,
    promptTaskId: item.promptTaskId ?? null,
    promptError: item.promptError ?? null,
  };
}
