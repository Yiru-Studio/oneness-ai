import type { PrismaClient } from '@prisma/client';
import type { Readable } from 'node:stream';
import type { Logger } from '../logger.js';
import type { TaskType } from '../enums.js';

/**
 * Output asset emitted by a provider. The worker writes it to MinIO under
 * task-outputs/<userId>/tasks/<taskId>/<assetId>.<ext> and creates the Asset row.
 */
export type ProviderOutputAsset = {
  data: Buffer | Readable;
  contentType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  /** Role applied to the TaskAsset link row. Defaults to 'output'. */
  role?: 'output' | 'reference';
};

export type ProviderResult = {
  outputJson?: Record<string, unknown>;
  outputAssets?: ProviderOutputAsset[];
  /** Overrides the reserved costCredits. If null/undefined, reserved estimate stays. */
  actualCostCredits?: number;
};

/**
 * The worker passes one of these to each provider call. Providers must
 * honour the abortSignal (e.g. polling network ops with AbortController)
 * so cancel can stop in-flight work.
 */
export type ProviderContext = {
  taskId: string;
  ownerId: string;
  projectId: string | null;
  prisma: PrismaClient;
  log: Logger;
  abortSignal: AbortSignal;
};

export interface ImageProvider {
  readonly name: string;
  generate(input: ImageInput, ctx: ProviderContext): Promise<ProviderResult>;
}

export interface VideoProvider {
  readonly name: string;
  generate(input: VideoInput, ctx: ProviderContext): Promise<ProviderResult>;
}

export interface TextProvider {
  readonly name: string;
  analyze(input: TextInput, ctx: ProviderContext): Promise<ProviderResult>;
}

export type ImageInput = {
  prompt: string;
  ratio: string;
  model: string;
  referenceAssetIds?: string[];
  n?: number;
};
export type VideoInput = {
  prompt: string;
  model: string;
  duration: number;
  fromAssetId?: string;
};
export type TextInput = {
  episodeId: string;
  analysisType: 'general' | 'basic';
};

/** Convenience union — used by worker's registry. */
export type AnyProvider = ImageProvider | VideoProvider | TextProvider;

export type ProviderKind = 'image' | 'video' | 'text';

export function providerKindOf(type: TaskType): ProviderKind {
  switch (type) {
    case 'IMAGE':        return 'image';
    case 'VIDEO':        return 'video';
    case 'TEXT_ANALYZE': return 'text';
  }
}
