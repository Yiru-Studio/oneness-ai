import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeCharacter } from '../serializers/character.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateCharacterSchema,
  UpdateCharacterSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';

export const characterRoutes = new Hono();

characterRoutes.use('/projects/:id/characters', tryReadUser, requireUser);
characterRoutes.use('/characters/:id', tryReadUser, requireUser);

// GET /projects/:id/characters
characterRoutes.get(
  '/projects/:id/characters',
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
    const characters = await prisma.character.findMany({
      where: { projectId },
      include: { styles: { include: { asset: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const serialized = await Promise.all(characters.map(serializeCharacter));
    return c.json(serialized);
  },
);

// POST /projects/:id/characters
characterRoutes.post(
  '/projects/:id/characters',
  zValidator('param', IdParamSchema),
  zValidator('json', CreateCharacterSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const body = c.req.valid('json');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    const avatarKey = await resolveAvatarKey(body.avatarAssetId, user.id);
    const created = await prisma.character.create({
      data: {
        projectId,
        name: body.name,
        description: body.description ?? '',
        bio: body.bio ?? '',
        voice: body.voice ?? null,
        avatarKey,
      },
      include: { styles: { include: { asset: true } } },
    });
    return c.json(await serializeCharacter(created), 201);
  },
);

// GET /characters/:id
characterRoutes.get(
  '/characters/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const character = await loadOwnedCharacter(id, user.id);
    return c.json(await serializeCharacter(character));
  },
);

// PATCH /characters/:id
characterRoutes.patch(
  '/characters/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateCharacterSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await loadOwnedCharacter(id, user.id);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.bio !== undefined) data.bio = body.bio;
    if (body.voice !== undefined) data.voice = body.voice;
    if (body.avatarAssetId !== undefined) {
      data.avatarKey = await resolveAvatarKey(body.avatarAssetId, user.id);
    }
    const updated = await prisma.character.update({
      where: { id },
      data,
      include: { styles: { include: { asset: true } } },
    });
    return c.json(await serializeCharacter(updated));
  },
);

// DELETE /characters/:id
characterRoutes.delete(
  '/characters/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    await loadOwnedCharacter(id, user.id);
    await prisma.character.delete({ where: { id } });
    return c.body(null, 204);
  },
);

async function loadOwnedCharacter(id: string, userId: string) {
  const character = await prisma.character.findFirst({
    where: { id, project: { ownerId: userId } },
    include: { styles: { include: { asset: true } } },
  });
  if (!character) {
    throw AppError.notFound(ErrorCodes.CHARACTER_NOT_FOUND, 'character not found');
  }
  return character;
}

async function resolveAvatarKey(
  assetId: string | null | undefined,
  userId: string,
): Promise<string | null> {
  if (!assetId) return null;
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId: userId },
    select: { key: true },
  });
  if (!asset) {
    throw AppError.notFound(ErrorCodes.ASSET_NOT_FOUND, 'avatar asset not found');
  }
  return asset.key;
}
