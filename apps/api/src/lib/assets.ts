import { minioClient } from './minio.js';
import type { Asset } from '@oneness/shared/prisma';

export type AssetDTO = {
  id: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
};

const URL_EXPIRY_SECONDS = 60 * 60; // 1 hour

export async function presignGet(bucket: string, key: string): Promise<string> {
  return minioClient.presignedGetObject(bucket, key, URL_EXPIRY_SECONDS);
}

export async function serializeAsset(asset: Asset): Promise<AssetDTO> {
  const url = await presignGet(asset.bucket, asset.key);
  return {
    id: asset.id,
    url,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
  };
}

export async function serializeOptionalAsset(asset: Asset | null): Promise<AssetDTO | null> {
  return asset ? serializeAsset(asset) : null;
}

/**
 * For a key stored directly on a row (e.g. User.avatarKey, Character.avatarKey)
 * — when there's no full Asset record. Returns a presigned URL or null.
 */
export async function presignKey(bucket: string, key: string | null): Promise<string | null> {
  if (!key) return null;
  return presignGet(bucket, key);
}
