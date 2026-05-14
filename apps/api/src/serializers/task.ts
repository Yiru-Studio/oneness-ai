import type { Task, TaskAsset, Asset } from '@oneness/shared/prisma';
import { serializeAsset, type AssetDTO } from '../lib/assets.js';

type TaskAssetWithAsset = TaskAsset & { asset: Asset };
type TaskWithAssets = Task & { assets: TaskAssetWithAsset[] };

export type TaskDTO = {
  id: string;
  type: 'IMAGE' | 'VIDEO' | 'TEXT_ANALYZE';
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  provider: string;
  projectId: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  costCredits: number;
  outputAssets: AssetDTO[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export async function serializeTask(t: TaskWithAssets): Promise<TaskDTO> {
  const outputAssets = await Promise.all(
    t.assets
      .filter((a) => a.role === 'output')
      .map((a) => serializeAsset(a.asset)),
  );
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    provider: t.provider,
    projectId: t.projectId,
    input: t.input,
    output: t.output,
    error: t.error,
    costCredits: t.costCredits,
    outputAssets,
    createdAt: t.createdAt.toISOString(),
    startedAt: t.startedAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
  };
}
