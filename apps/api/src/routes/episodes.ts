import { Hono } from 'hono';
import { zValidator } from '../middleware/validator';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeEpisode } from '../serializers/episode.js';
import { serializeTask } from '../serializers/task.js';
import { enqueueTaskJob } from '../lib/queues.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import { config } from '../config.js';
import {
  CreateEpisodeSchema,
  UpdateEpisodeSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';
import { TaskType, TaskStatus } from '@oneness/shared/enums';
import { estimateCost } from '@oneness/shared/pricing';
import { queueForTaskType } from '@oneness/shared/queues';

const SUBJECT_TYPES = ['characters', 'items', 'scenes'] as const;
type SubjectType = (typeof SUBJECT_TYPES)[number];

export const episodeRoutes = new Hono();
episodeRoutes.use('/projects/:id/episodes', tryReadUser, requireUser);
episodeRoutes.use('/projects/:id/episodes/:episodeId/analyze', tryReadUser, requireUser);
episodeRoutes.use('/projects/:id/episodes/:episodeId/analyze-storyboard', tryReadUser, requireUser);
episodeRoutes.use('/projects/:id/episodes/:episodeId/generate-shots', tryReadUser, requireUser);
episodeRoutes.use('/episodes/:id', tryReadUser, requireUser);

// Reserves credits for one TEXT_ANALYZE task, creates it, and enqueues it.
// Shared by the scene-list ("分析剧集") and shot-breakdown ("智能分镜创作") flows.
async function createTextTask(
  userId: string,
  projectId: string,
  input: Prisma.InputJsonValue,
) {
  const cost = estimateCost(TaskType.TEXT_ANALYZE);
  const providerName = config.PROVIDER_TEXT;
  const task = await prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
    if (!u) throw AppError.unauthorized();
    if (u.credits < cost) {
      throw AppError.badRequest(
        ErrorCodes.INSUFFICIENT_CREDITS,
        `requires ${cost} credits, have ${u.credits}`,
        { required: cost, available: u.credits },
      );
    }
    await tx.user.update({ where: { id: userId }, data: { credits: { decrement: cost } } });
    return tx.task.create({
      data: {
        ownerId: userId,
        projectId,
        type: TaskType.TEXT_ANALYZE,
        provider: providerName,
        status: TaskStatus.QUEUED,
        input,
        costCredits: cost,
      },
      include: { assets: { include: { asset: true } } },
    });
  });
  await enqueueTaskJob(queueForTaskType(TaskType.TEXT_ANALYZE), task.id);
  return task;
}

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

// POST /projects/:id/episodes/:episodeId/analyze
// Fans out parallel TEXT_ANALYZE tasks for characters / items / scenes.
// Credits for all three are reserved atomically; if any reservation would
// overdraw, none are reserved and the call 400s.
episodeRoutes.post('/projects/:id/episodes/:episodeId/analyze', async (c) => {
  const user = c.var.user!;
  const projectId = c.req.param('id');
  const episodeId = c.req.param('episodeId');

  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: user.id },
    select: { id: true, analysisModel: true },
  });
  if (!project) {
    throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
  }
  const episode = await prisma.storyboardEpisode.findFirst({
    where: { id: episodeId, projectId },
    select: { id: true },
  });
  if (!episode) {
    throw AppError.notFound(ErrorCodes.EPISODE_NOT_FOUND, 'episode not found');
  }

  const perTaskCost = estimateCost(TaskType.TEXT_ANALYZE);
  const totalCost = perTaskCost * SUBJECT_TYPES.length;
  const providerName = config.PROVIDER_TEXT;

  const tasks = await prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({
      where: { id: user.id },
      select: { credits: true },
    });
    if (!u) throw AppError.unauthorized();
    if (u.credits < totalCost) {
      throw AppError.badRequest(
        ErrorCodes.INSUFFICIENT_CREDITS,
        `requires ${totalCost} credits, have ${u.credits}`,
        { required: totalCost, available: u.credits },
      );
    }
    await tx.user.update({
      where: { id: user.id },
      data: { credits: { decrement: totalCost } },
    });
    const created = [];
    for (const subjectType of SUBJECT_TYPES) {
      const t = await tx.task.create({
        data: {
          ownerId: user.id,
          projectId,
          type: TaskType.TEXT_ANALYZE,
          provider: providerName,
          status: TaskStatus.QUEUED,
          input: {
            episodeId,
            subjectType,
            model: project.analysisModel,
          } as Prisma.InputJsonValue,
          costCredits: perTaskCost,
        },
        include: { assets: { include: { asset: true } } },
      });
      created.push(t);
    }
    return created;
  });

  // Enqueue after the transaction commits so workers can't observe half-created Tasks.
  await Promise.all(
    tasks.map((t) => enqueueTaskJob(queueForTaskType(TaskType.TEXT_ANALYZE), t.id)),
  );

  const serialized = await Promise.all(tasks.map(serializeTask));
  return c.json({ tasks: serialized }, 201);
});

// POST /projects/:id/episodes/:episodeId/analyze-storyboard
// likeai's "分析剧集": fans out a TEXT_ANALYZE task that breaks the episode
// into scenes (summary + scenes[]) and flips `analyzed` when it completes.
// Returns the task so the client can poll it, then re-fetch the episode.
episodeRoutes.post('/projects/:id/episodes/:episodeId/analyze-storyboard', async (c) => {
  const user = c.var.user!;
  const projectId = c.req.param('id');
  const episodeId = c.req.param('episodeId');

  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: user.id },
    select: { id: true, analysisModel: true },
  });
  if (!project) {
    throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
  }
  const episode = await prisma.storyboardEpisode.findFirst({
    where: { id: episodeId, projectId },
    select: { id: true },
  });
  if (!episode) {
    throw AppError.notFound(ErrorCodes.EPISODE_NOT_FOUND, 'episode not found');
  }

  const task = await createTextTask(user.id, projectId, {
    episodeId,
    analysisType: 'scene_list',
    model: project.analysisModel,
  } as Prisma.InputJsonValue);

  return c.json({ task: await serializeTask(task) }, 201);
});

// POST /projects/:id/episodes/:episodeId/generate-shots
// likeai's AI-assist "智能分镜创作": fans out a TEXT_ANALYZE task that breaks
// one analyzed scene into a shot list and creates the Shot rows.
// Body: { sceneIndex: number }. Returns the task to poll.
episodeRoutes.post('/projects/:id/episodes/:episodeId/generate-shots', async (c) => {
  const user = c.var.user!;
  const projectId = c.req.param('id');
  const episodeId = c.req.param('episodeId');

  const body = (await c.req.json().catch(() => ({}))) as { sceneIndex?: unknown };
  const sceneIndex = Number(body.sceneIndex);
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_FAILED,
      'sceneIndex must be a non-negative integer',
    );
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: user.id },
    select: { id: true, analysisModel: true },
  });
  if (!project) {
    throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
  }
  const episode = await prisma.storyboardEpisode.findFirst({
    where: { id: episodeId, projectId },
    select: { id: true, analyzed: true, scenesJson: true },
  });
  if (!episode) {
    throw AppError.notFound(ErrorCodes.EPISODE_NOT_FOUND, 'episode not found');
  }
  const scenes = Array.isArray(episode.scenesJson) ? episode.scenesJson : [];
  if (!episode.analyzed || scenes.length === 0) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_FAILED,
      'episode not analyzed yet; run 分析剧集 first',
    );
  }
  if (sceneIndex >= scenes.length) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_FAILED,
      `sceneIndex out of range (0..${scenes.length - 1})`,
    );
  }

  const task = await createTextTask(user.id, projectId, {
    episodeId,
    sceneIndex,
    analysisType: 'shot_breakdown',
    model: project.analysisModel,
  } as Prisma.InputJsonValue);

  return c.json({ task: await serializeTask(task) }, 201);
});

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
