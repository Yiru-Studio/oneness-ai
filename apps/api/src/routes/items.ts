import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeItem } from '../serializers/item.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateItemSchema,
  UpdateItemSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';

export const itemRoutes = new Hono();
itemRoutes.use('/projects/:id/items', tryReadUser, requireUser);
itemRoutes.use('/items/:id', tryReadUser, requireUser);

itemRoutes.get(
  '/projects/:id/items',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    const items = await prisma.item.findMany({
      where: { projectId },
      include: { asset: true },
      orderBy: { createdAt: 'asc' },
    });
    return c.json(await Promise.all(items.map(serializeItem)));
  },
);

itemRoutes.post(
  '/projects/:id/items',
  zValidator('param', IdParamSchema),
  zValidator('json', CreateItemSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const { name, assetId } = c.req.valid('json');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    if (assetId) await assertAssetOwned(assetId, user.id);
    const created = await prisma.item.create({
      data: { projectId, name, assetId: assetId ?? null },
      include: { asset: true },
    });
    return c.json(await serializeItem(created), 201);
  },
);

itemRoutes.patch(
  '/items/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateItemSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await loadOwnedItem(id, user.id);
    if (body.assetId !== undefined && body.assetId !== null) {
      await assertAssetOwned(body.assetId, user.id);
    }
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.assetId !== undefined) data.assetId = body.assetId;
    const updated = await prisma.item.update({
      where: { id: existing.id },
      data,
      include: { asset: true },
    });
    return c.json(await serializeItem(updated));
  },
);

itemRoutes.delete(
  '/items/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const existing = await loadOwnedItem(id, user.id);
    await prisma.item.delete({ where: { id: existing.id } });
    return c.body(null, 204);
  },
);

async function loadOwnedItem(id: string, userId: string) {
  const row = await prisma.item.findFirst({
    where: { id, project: { ownerId: userId } },
    include: { asset: true },
  });
  if (!row) throw AppError.notFound(ErrorCodes.ITEM_NOT_FOUND, 'item not found');
  return row;
}

async function assertAssetOwned(assetId: string, userId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId: userId },
    select: { id: true },
  });
  if (!asset) throw AppError.notFound(ErrorCodes.ASSET_NOT_FOUND, 'asset not found');
}
