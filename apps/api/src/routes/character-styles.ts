import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { presignGet } from '../lib/assets.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateCharacterStyleSchema,
  UpdateCharacterStyleSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';
import type { CharacterStyle, Asset } from '@oneness/shared/prisma';

export const characterStyleRoutes = new Hono();

characterStyleRoutes.use('/characters/:id/styles', tryReadUser, requireUser);
characterStyleRoutes.use('/character-styles/:id', tryReadUser, requireUser);

type StyleDTO = { id: string; name: string; image: string };

async function toDTO(style: CharacterStyle & { asset: Asset | null }): Promise<StyleDTO> {
  return {
    id: style.id,
    name: style.name,
    image: style.asset ? await presignGet(style.asset.bucket, style.asset.key) : '',
  };
}

// POST /characters/:id/styles
characterStyleRoutes.post(
  '/characters/:id/styles',
  zValidator('param', IdParamSchema),
  zValidator('json', CreateCharacterStyleSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: characterId } = c.req.valid('param');
    const { name, assetId } = c.req.valid('json');
    const character = await prisma.character.findFirst({
      where: { id: characterId, project: { ownerId: user.id } },
      select: { id: true },
    });
    if (!character) {
      throw AppError.notFound(ErrorCodes.CHARACTER_NOT_FOUND, 'character not found');
    }
    if (assetId) await assertAssetOwned(assetId, user.id);
    const style = await prisma.characterStyle.create({
      data: { characterId, name, assetId: assetId ?? null },
      include: { asset: true },
    });
    return c.json(await toDTO(style), 201);
  },
);

// PATCH /character-styles/:id
characterStyleRoutes.patch(
  '/character-styles/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateCharacterStyleSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await loadOwnedStyle(id, user.id);
    if (body.assetId !== undefined && body.assetId !== null) {
      await assertAssetOwned(body.assetId, user.id);
    }
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.assetId !== undefined) data.assetId = body.assetId;
    const updated = await prisma.characterStyle.update({
      where: { id: existing.id },
      data,
      include: { asset: true },
    });
    return c.json(await toDTO(updated));
  },
);

// DELETE /character-styles/:id
characterStyleRoutes.delete(
  '/character-styles/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const existing = await loadOwnedStyle(id, user.id);
    await prisma.characterStyle.delete({ where: { id: existing.id } });
    return c.body(null, 204);
  },
);

async function loadOwnedStyle(id: string, userId: string) {
  const row = await prisma.characterStyle.findFirst({
    where: { id, character: { project: { ownerId: userId } } },
    include: { asset: true },
  });
  if (!row) {
    throw AppError.notFound(ErrorCodes.NOT_FOUND, 'character style not found');
  }
  return row;
}

async function assertAssetOwned(assetId: string, userId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId: userId },
    select: { id: true },
  });
  if (!asset) throw AppError.notFound(ErrorCodes.ASSET_NOT_FOUND, 'asset not found');
}
