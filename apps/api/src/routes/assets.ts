import { Hono } from 'hono';
import { zValidator } from '../middleware/validator';
import { createId } from '@paralleldrive/cuid2';
import sharp from 'sharp';
import { prisma } from '../lib/prisma.js';
import { minioClient, Buckets } from '../lib/minio.js';
import { serializeAsset } from '../lib/assets.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  ALLOWED_CONTENT_TYPES,
  MAX_ASSET_BYTES,
  isAllowedContentType,
} from '@oneness/shared/schemas';
import { IdParamSchema } from '@oneness/shared/schemas';

export const assetRoutes = new Hono();

assetRoutes.use('/assets', tryReadUser, requireUser);
assetRoutes.use('/assets/*', tryReadUser, requireUser);

assetRoutes.post('/assets', async (c) => {
  const user = c.var.user!;
  const form = await c.req.parseBody();

  const file = form['file'];
  if (!(file instanceof File)) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_FAILED,
      'file field is required and must be a file',
    );
  }
  if (file.size === 0) {
    throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'file is empty');
  }
  if (file.size > MAX_ASSET_BYTES) {
    throw AppError.badRequest(
      ErrorCodes.ASSET_TOO_LARGE,
      `file exceeds ${MAX_ASSET_BYTES} bytes`,
      { sizeBytes: file.size, maxBytes: MAX_ASSET_BYTES },
    );
  }
  const contentType = file.type || 'application/octet-stream';
  if (!isAllowedContentType(contentType)) {
    throw AppError.badRequest(
      ErrorCodes.ASSET_TYPE_NOT_ALLOWED,
      `contentType ${contentType} is not allowed`,
      { allowed: ALLOWED_CONTENT_TYPES },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // Image dimensions (skip silently if sharp can't read it).
  let width: number | null = null;
  let height: number | null = null;
  if (contentType.startsWith('image/')) {
    try {
      const meta = await sharp(buf).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch {
      // Non-fatal — leave dimensions null.
    }
  }

  const assetId = createId();
  const ext = extFromContentType(contentType);
  const today = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
  const key = `${user.id}/${today}/${assetId}.${ext}`;

  await minioClient.putObject(
    Buckets.USER_UPLOADS,
    key,
    buf,
    buf.length,
    { 'Content-Type': contentType },
  );

  const asset = await prisma.asset.create({
    data: {
      id: assetId,
      ownerId: user.id,
      bucket: Buckets.USER_UPLOADS,
      key,
      contentType,
      sizeBytes: buf.length,
      width,
      height,
      durationMs: null,
    },
  });

  return c.json(await serializeAsset(asset), 201);
});

assetRoutes.delete('/assets/:id', zValidator('param', IdParamSchema), async (c) => {
  const user = c.var.user!;
  const { id } = c.req.valid('param');
  const asset = await prisma.asset.findFirst({ where: { id, ownerId: user.id } });
  if (!asset) {
    throw AppError.notFound(ErrorCodes.ASSET_NOT_FOUND, 'asset not found');
  }

  await prisma.asset.delete({ where: { id } });
  // Best-effort MinIO removal — log on failure but don't fail the request.
  try {
    await minioClient.removeObject(asset.bucket, asset.key);
  } catch (err) {
    c.var.log.warn({ err: (err as Error).message, key: asset.key }, 'minio removeObject failed');
  }

  return c.body(null, 204);
});

function extFromContentType(ct: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
  };
  return map[ct] ?? 'bin';
}
