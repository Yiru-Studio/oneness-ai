import type { Shot, Asset, Task } from '@oneness/shared/prisma';
import { serializeOptionalAsset, type AssetDTO } from '../lib/assets.js';

type ShotWithAssets = Shot & {
  sketch: Asset | null;
  video: Asset | null;
  lastFrame: Asset | null;
  videoTask: Task | null;
};

export type ShotDTO = {
  id: string;
  episodeId: string;
  displayId: number;
  shotType: 'new' | 'continuation';
  preId: number | null;
  duration: number;
  prompt: string;
  model: string;
  ratio: string;
  resolution: string;
  generateAudio: boolean;
  createType: 'manual' | 'assist';
  sketch: AssetDTO | null;
  video: AssetDTO | null;
  lastFrame: AssetDTO | null;
  videoTaskId: string | null;
  videoTaskStatus: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | null;
  characterStyleIds: string[];
  sceneIds: string[];
  itemIds: string[];
  createdAt: string;
  updatedAt: string;
};

function jsonArray(v: unknown): string[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : [];
}

export async function serializeShot(s: ShotWithAssets): Promise<ShotDTO> {
  const [sketch, video, lastFrame] = await Promise.all([
    serializeOptionalAsset(s.sketch),
    serializeOptionalAsset(s.video),
    serializeOptionalAsset(s.lastFrame),
  ]);
  return {
    id: s.id,
    episodeId: s.episodeId,
    displayId: s.displayId,
    shotType: s.shotType as 'new' | 'continuation',
    preId: s.preId,
    duration: s.duration,
    prompt: s.prompt,
    model: s.model,
    ratio: s.ratio,
    resolution: s.resolution,
    generateAudio: s.generateAudio,
    createType: s.createType as 'manual' | 'assist',
    sketch,
    video,
    lastFrame,
    videoTaskId: s.videoTaskId,
    videoTaskStatus: (s.videoTask?.status as ShotDTO['videoTaskStatus']) ?? null,
    characterStyleIds: jsonArray(s.characterStyleIds),
    sceneIds: jsonArray(s.sceneIds),
    itemIds: jsonArray(s.itemIds),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
