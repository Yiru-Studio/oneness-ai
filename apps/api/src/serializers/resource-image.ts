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
  identityReferenceAssetId: string | null;
  referenceAssetIds: string[];
  createdAt: string;
  updatedAt: string;
};

export async function serializeResourceImage(
  row: ResourceImageWithRelations,
): Promise<ResourceImageDTO> {
  const asset = row.asset ? await serializeAsset(row.asset) : null;
  const taskInput = parseTaskInput(row.task?.input);
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
    identityReferenceAssetId: taskInput.identityReferenceAssetId,
    referenceAssetIds: taskInput.referenceAssetIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseTaskInput(input: unknown): {
  identityReferenceAssetId: string | null;
  referenceAssetIds: string[];
} {
  if (!input || typeof input !== 'object') {
    return { identityReferenceAssetId: null, referenceAssetIds: [] };
  }
  const obj = input as {
    identityReferenceAssetId?: unknown;
    referenceAssetIds?: unknown;
  };
  const referenceAssetIds = Array.isArray(obj.referenceAssetIds)
    ? obj.referenceAssetIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    identityReferenceAssetId:
      typeof obj.identityReferenceAssetId === 'string' ? obj.identityReferenceAssetId : null,
    referenceAssetIds,
  };
}
