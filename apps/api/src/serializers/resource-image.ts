import type { Asset, ResourceImage, Task } from '@oneness/shared/prisma';
import { serializeAsset, type AssetDTO } from '../lib/assets.js';
import { entityIdFromResourceImage } from '../lib/resource-images.js';

type ResourceImageWithRelations = ResourceImage & {
  asset: Asset | null;
  task: Task | null;
};

export type ResourceImageDTO = {
  id: string;
  kind: string;
  entityId: string | null;
  source: string;
  status: string;
  prompt: string;
  model: string | null;
  ratio: string | null;
  error: string | null;
  assetId: string | null;
  taskId: string | null;
  image: string;
  asset: AssetDTO | null;
  taskStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function serializeResourceImage(
  row: ResourceImageWithRelations,
): Promise<ResourceImageDTO> {
  const asset = row.asset ? await serializeAsset(row.asset) : null;
  return {
    id: row.id,
    kind: row.kind,
    entityId: entityIdFromResourceImage(row),
    source: row.source,
    status: row.status,
    prompt: row.prompt ?? '',
    model: row.model ?? null,
    ratio: row.ratio ?? null,
    error: row.error ?? null,
    assetId: row.assetId ?? null,
    taskId: row.taskId ?? null,
    image: asset?.url ?? '',
    asset,
    taskStatus: row.task?.status ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
