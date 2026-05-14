import { Hono } from 'hono';
import { zValidator } from '../middleware/validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeScene } from '../serializers/scene.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateSceneSchema,
  UpdateSceneSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';

export const sceneRoutes = new Hono();
sceneRoutes.use('/projects/:id/scenes', tryReadUser, requireUser);
sceneRoutes.use('/scenes/:id', tryReadUser, requireUser);

sceneRoutes.get(
  '/projects/:id/scenes',
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
    const scenes = await prisma.scene.findMany({
      where: { projectId },
      include: { asset: true },
      orderBy: { createdAt: 'asc' },
    });
    return c.json(await Promise.all(scenes.map(serializeScene)));
  },
);

sceneRoutes.post(
  '/projects/:id/scenes',
  zValidator('param', IdParamSchema),
  zValidator('json', CreateSceneSchema),
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
    const created = await prisma.scene.create({
      data: { projectId, name, assetId: assetId ?? null },
      include: { asset: true },
    });
    return c.json(await serializeScene(created), 201);
  },
);

sceneRoutes.patch(
  '/scenes/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateSceneSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await loadOwnedScene(id, user.id);
    if (body.assetId !== undefined && body.assetId !== null) {
      await assertAssetOwned(body.assetId, user.id);
    }
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.assetId !== undefined) data.assetId = body.assetId;
    const updated = await prisma.scene.update({
      where: { id: existing.id },
      data,
      include: { asset: true },
    });
    return c.json(await serializeScene(updated));
  },
);

sceneRoutes.delete(
  '/scenes/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const existing = await loadOwnedScene(id, user.id);
    await prisma.scene.delete({ where: { id: existing.id } });
    return c.body(null, 204);
  },
);

async function loadOwnedScene(id: string, userId: string) {
  const row = await prisma.scene.findFirst({
    where: { id, project: { ownerId: userId } },
    include: { asset: true },
  });
  if (!row) throw AppError.notFound(ErrorCodes.SCENE_NOT_FOUND, 'scene not found');
  return row;
}

async function assertAssetOwned(assetId: string, userId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId: userId },
    select: { id: true },
  });
  if (!asset) throw AppError.notFound(ErrorCodes.ASSET_NOT_FOUND, 'asset not found');
}
