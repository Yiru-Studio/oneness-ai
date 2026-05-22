import { Hono } from 'hono';
import { zValidator } from '../middleware/validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import {
  assertAssetOwned,
  assertTaskOwned,
  loadOwnedResourceTarget,
  resourceImageEntityFields,
  resourceImageEntityWhere,
  setCurrentResourceAsset,
  entityIdFromResourceImage,
} from '../lib/resource-images.js';
import { serializeResourceImage } from '../serializers/resource-image.js';
import {
  CreateResourceImageSchema,
  UpdateResourceImageSchema,
  ResourceImageListQuerySchema,
  IdParamSchema,
  type ResourceImageKind,
} from '@oneness/shared/schemas';
import { AppError, ErrorCodes } from '@oneness/shared/errors';

export const resourceImageRoutes = new Hono();

resourceImageRoutes.use('/resource-images', tryReadUser, requireUser);
resourceImageRoutes.use('/resource-images/*', tryReadUser, requireUser);

resourceImageRoutes.get(
  '/resource-images',
  zValidator('query', ResourceImageListQuerySchema),
  async (c) => {
    const user = c.var.user!;
    const q = c.req.valid('query');
    await loadOwnedResourceTarget(prisma, q.kind, q.entityId, user.id);
    const rows = await prisma.resourceImage.findMany({
      where: {
        ownerId: user.id,
        kind: q.kind,
        ...resourceImageEntityWhere(q.kind, q.entityId),
      },
      include: { asset: true, task: true },
      orderBy: { createdAt: 'desc' },
    });
    return c.json(await Promise.all(rows.map(serializeResourceImage)));
  },
);

resourceImageRoutes.post(
  '/resource-images',
  zValidator('json', CreateResourceImageSchema),
  async (c) => {
    const user = c.var.user!;
    const body = c.req.valid('json');
    const target = await loadOwnedResourceTarget(
      prisma,
      body.kind,
      body.entityId,
      user.id,
    );

    if (body.assetId) await assertAssetOwned(prisma, body.assetId, user.id);
    if (body.taskId) await assertTaskOwned(prisma, body.taskId, user.id);

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.resourceImage.create({
        data: {
          ownerId: user.id,
          projectId: target.projectId,
          kind: body.kind,
          source: body.source,
          status: body.status,
          prompt: body.prompt ?? '',
          model: body.model ?? null,
          ratio: body.ratio ?? null,
          assetId: body.assetId ?? null,
          taskId: body.taskId ?? null,
          error: body.error ?? null,
          ...resourceImageEntityFields(body.kind, body.entityId),
        },
        include: { asset: true, task: true },
      });
      if (body.setAsCurrent && body.assetId) {
        await setCurrentResourceAsset(tx, body.kind, body.entityId, body.assetId);
      }
      return row;
    });

    return c.json(await serializeResourceImage(created), 201);
  },
);

resourceImageRoutes.patch(
  '/resource-images/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateResourceImageSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await prisma.resourceImage.findFirst({
      where: { id, ownerId: user.id },
      include: { asset: true, task: true },
    });
    if (!existing) {
      throw AppError.notFound(ErrorCodes.NOT_FOUND, 'resource image not found');
    }
    const entityId = entityIdFromResourceImage(existing);
    if (!entityId) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'resource image has no entity');
    }

    const kind = existing.kind as ResourceImageKind;
    await loadOwnedResourceTarget(prisma, kind, entityId, user.id);
    if (body.assetId !== undefined && body.assetId !== null) {
      await assertAssetOwned(prisma, body.assetId, user.id);
    }
    if (body.taskId !== undefined && body.taskId !== null) {
      await assertTaskOwned(prisma, body.taskId, user.id);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.resourceImage.update({
        where: { id: existing.id },
        data: {
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
          ...(body.model !== undefined ? { model: body.model } : {}),
          ...(body.ratio !== undefined ? { ratio: body.ratio } : {}),
          ...(body.assetId !== undefined ? { assetId: body.assetId } : {}),
          ...(body.taskId !== undefined ? { taskId: body.taskId } : {}),
          ...(body.error !== undefined ? { error: body.error } : {}),
        },
        include: { asset: true, task: true },
      });
      const currentAssetId =
        body.assetId !== undefined ? body.assetId : existing.assetId;
      if (body.setAsCurrent && currentAssetId) {
        await setCurrentResourceAsset(tx, kind, entityId, currentAssetId);
      }
      return row;
    });

    return c.json(await serializeResourceImage(updated));
  },
);
