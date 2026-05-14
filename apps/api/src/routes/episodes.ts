import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeEpisode } from '../serializers/episode.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateEpisodeSchema,
  UpdateEpisodeSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';

export const episodeRoutes = new Hono();
episodeRoutes.use('/projects/:id/episodes', tryReadUser, requireUser);
episodeRoutes.use('/episodes/:id', tryReadUser, requireUser);

episodeRoutes.get(
  '/projects/:id/episodes',
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
    const episodes = await prisma.storyboardEpisode.findMany({
      where: { projectId },
      orderBy: { number: 'asc' },
    });
    return c.json(episodes.map(serializeEpisode));
  },
);

episodeRoutes.post(
  '/projects/:id/episodes',
  zValidator('param', IdParamSchema),
  zValidator('json', CreateEpisodeSchema),
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
    try {
      const created = await prisma.storyboardEpisode.create({
        data: { projectId, ...body },
      });
      return c.json(serializeEpisode(created), 201);
    } catch (err: unknown) {
      if (isUniqueConstraint(err)) {
        throw AppError.conflict(
          ErrorCodes.CONFLICT,
          `episode number ${body.number} already exists in this project`,
        );
      }
      throw err;
    }
  },
);

episodeRoutes.patch(
  '/episodes/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateEpisodeSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await loadOwned(id, user.id);
    try {
      const updated = await prisma.storyboardEpisode.update({
        where: { id: existing.id },
        data: body,
      });
      return c.json(serializeEpisode(updated));
    } catch (err: unknown) {
      if (isUniqueConstraint(err)) {
        throw AppError.conflict(
          ErrorCodes.CONFLICT,
          `episode number ${body.number} already exists in this project`,
        );
      }
      throw err;
    }
  },
);

episodeRoutes.delete(
  '/episodes/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const existing = await loadOwned(id, user.id);
    await prisma.storyboardEpisode.delete({ where: { id: existing.id } });
    return c.body(null, 204);
  },
);

async function loadOwned(id: string, userId: string) {
  const row = await prisma.storyboardEpisode.findFirst({
    where: { id, project: { ownerId: userId } },
  });
  if (!row) throw AppError.notFound(ErrorCodes.EPISODE_NOT_FOUND, 'episode not found');
  return row;
}

function isUniqueConstraint(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002',
  );
}
