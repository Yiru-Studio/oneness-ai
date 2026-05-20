import { Hono } from 'hono';
import { Prisma } from '@prisma/client';
import { zValidator } from '../middleware/validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeShot } from '../serializers/shot.js';
import { enqueueTaskJob } from '../lib/queues.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import { config } from '../config.js';
import {
  CreateShotSchema,
  UpdateShotSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';
import { TaskType, TaskStatus } from '@oneness/shared/enums';
import { estimateCost } from '@oneness/shared/pricing';
import { queueForTaskType } from '@oneness/shared/queues';
import type { VideoReference } from '@oneness/shared/providers';

export const shotRoutes = new Hono();

shotRoutes.use('/projects/:id/episodes/:episodeId/shots', tryReadUser, requireUser);
shotRoutes.use('/shots/:id', tryReadUser, requireUser);
shotRoutes.use('/shots/:id/*', tryReadUser, requireUser);

const SHOT_INCLUDE = {
  sketch: true,
  video: true,
  lastFrame: true,
  videoTask: true,
} as const;

async function ownedEpisode(projectId: string, episodeId: string, userId: string) {
  const ep = await prisma.storyboardEpisode.findFirst({
    where: { id: episodeId, projectId, project: { ownerId: userId } },
    select: { id: true, projectId: true },
  });
  if (!ep) throw AppError.notFound(ErrorCodes.EPISODE_NOT_FOUND, 'episode not found');
  return ep;
}

async function ownedShot(shotId: string, userId: string) {
  const shot = await prisma.shot.findFirst({
    where: { id: shotId, episode: { project: { ownerId: userId } } },
    include: { ...SHOT_INCLUDE, episode: { select: { id: true, projectId: true } } },
  });
  if (!shot) throw AppError.notFound(ErrorCodes.SHOT_NOT_FOUND, 'shot not found');
  return shot;
}

// GET /api/projects/:id/episodes/:episodeId/shots
shotRoutes.get('/projects/:id/episodes/:episodeId/shots', async (c) => {
  const user = c.var.user!;
  const projectId = c.req.param('id');
  const episodeId = c.req.param('episodeId');
  await ownedEpisode(projectId, episodeId, user.id);
  const shots = await prisma.shot.findMany({
    where: { episodeId },
    include: SHOT_INCLUDE,
    orderBy: { displayId: 'asc' },
  });
  const serialized = await Promise.all(shots.map(serializeShot));
  return c.json(serialized);
});

// POST /api/projects/:id/episodes/:episodeId/shots
shotRoutes.post(
  '/projects/:id/episodes/:episodeId/shots',
  zValidator('json', CreateShotSchema),
  async (c) => {
    const user = c.var.user!;
    const projectId = c.req.param('id');
    const episodeId = c.req.param('episodeId');
    await ownedEpisode(projectId, episodeId, user.id);
    const body = c.req.valid('json');

    const created = await prisma.$transaction(async (tx) => {
      // Decide the displayId — insert after a given index, or append.
      const existing = await tx.shot.findMany({
        where: { episodeId },
        select: { id: true, displayId: true },
        orderBy: { displayId: 'asc' },
      });

      let newDisplayId: number;
      if (body.afterDisplayId === undefined) {
        newDisplayId =
          (existing.reduce((m, s) => Math.max(m, s.displayId), 0) || 0) + 1;
      } else {
        // Shift everything strictly above afterDisplayId by +1, then insert at afterDisplayId+1.
        // We do this two-step (shift to negatives first, then to final) to avoid the
        // unique (episodeId, displayId) collision.
        const toShift = existing.filter((s) => s.displayId > body.afterDisplayId!);
        for (const s of toShift) {
          await tx.shot.update({
            where: { id: s.id },
            data: { displayId: -(s.displayId + 1) },
          });
        }
        for (const s of toShift) {
          await tx.shot.update({
            where: { id: s.id },
            data: { displayId: s.displayId + 1 },
          });
        }
        newDisplayId = body.afterDisplayId + 1;
      }

      return tx.shot.create({
        data: {
          episodeId,
          displayId: newDisplayId,
          sceneIndex: body.sceneIndex,
          shotType: body.shotType,
          preId: body.preId ?? null,
          duration: body.duration,
          prompt: body.prompt,
          model: body.model,
          ratio: body.ratio,
          resolution: body.resolution,
          generateAudio: body.generateAudio,
          createType: 'manual',
          characterStyleIds: body.characterStyleIds as Prisma.InputJsonValue,
          sceneIds: body.sceneIds as Prisma.InputJsonValue,
          itemIds: body.itemIds as Prisma.InputJsonValue,
        },
        include: SHOT_INCLUDE,
      });
    });

    return c.json(await serializeShot(created), 201);
  },
);

// PATCH /api/shots/:id
shotRoutes.patch(
  '/shots/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateShotSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await ownedShot(id, user.id);

    const data: Prisma.ShotUpdateInput = {};
    if (body.shotType !== undefined) data.shotType = body.shotType;
    if (body.preId !== undefined) data.preId = body.preId;
    if (body.duration !== undefined) data.duration = body.duration;
    if (body.prompt !== undefined) data.prompt = body.prompt;
    if (body.model !== undefined) data.model = body.model;
    if (body.ratio !== undefined) data.ratio = body.ratio;
    if (body.resolution !== undefined) data.resolution = body.resolution;
    if (body.generateAudio !== undefined) data.generateAudio = body.generateAudio;
    if (body.sketchAssetId !== undefined)
      data.sketch = body.sketchAssetId
        ? { connect: { id: body.sketchAssetId } }
        : { disconnect: true };
    if (body.characterStyleIds !== undefined)
      data.characterStyleIds = body.characterStyleIds as Prisma.InputJsonValue;
    if (body.sceneIds !== undefined)
      data.sceneIds = body.sceneIds as Prisma.InputJsonValue;
    if (body.itemIds !== undefined)
      data.itemIds = body.itemIds as Prisma.InputJsonValue;

    const updated = await prisma.shot.update({
      where: { id },
      data,
      include: SHOT_INCLUDE,
    });
    return c.json(await serializeShot(updated));
  },
);

// DELETE /api/shots/:id
shotRoutes.delete(
  '/shots/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const shot = await ownedShot(id, user.id);
    // Close the gap: shift everything above this displayId down by 1.
    await prisma.$transaction(async (tx) => {
      await tx.shot.delete({ where: { id: shot.id } });
      const toShift = await tx.shot.findMany({
        where: { episodeId: shot.episodeId, displayId: { gt: shot.displayId } },
        select: { id: true, displayId: true },
        orderBy: { displayId: 'asc' },
      });
      for (const s of toShift) {
        await tx.shot.update({
          where: { id: s.id },
          data: { displayId: -(s.displayId - 1) },
        });
      }
      for (const s of toShift) {
        await tx.shot.update({
          where: { id: s.id },
          data: { displayId: s.displayId - 1 },
        });
      }
    });
    return c.body(null, 204);
  },
);

// POST /api/shots/:id/generate-video
// Atomically reserves video credits, creates a VIDEO task with the shot's
// prompt + references, attaches it to the shot, and enqueues the job.
shotRoutes.post(
  '/shots/:id/generate-video',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const shot = await ownedShot(id, user.id);

    if (
      shot.videoTask &&
      (shot.videoTask.status === 'QUEUED' || shot.videoTask.status === 'RUNNING')
    ) {
      throw AppError.conflict(
        ErrorCodes.CONFLICT,
        'a video generation task is already in flight for this shot',
      );
    }
    if (!shot.prompt.trim()) {
      throw AppError.badRequest(
        ErrorCodes.VALIDATION_FAILED,
        'shot prompt is empty; add a prompt before generating',
      );
    }

    const references: VideoReference[] = await resolveReferences(shot);

    const provider = pickVideoProvider(shot.model);
    const cost = estimateCost(TaskType.VIDEO);

    const updatedShot = await prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({
        where: { id: user.id },
        select: { credits: true },
      });
      if (!u) throw AppError.unauthorized();
      if (u.credits < cost) {
        throw AppError.badRequest(
          ErrorCodes.INSUFFICIENT_CREDITS,
          `requires ${cost} credits, have ${u.credits}`,
          { required: cost, available: u.credits },
        );
      }
      await tx.user.update({
        where: { id: user.id },
        data: { credits: { decrement: cost } },
      });
      const task = await tx.task.create({
        data: {
          ownerId: user.id,
          projectId: shot.episode.projectId,
          type: TaskType.VIDEO,
          provider,
          status: TaskStatus.QUEUED,
          input: {
            shotId: shot.id,
            prompt: shot.prompt,
            model: modelIdForProvider(provider, shot.model),
            duration: shot.duration,
            ratio: shot.ratio,
            generateAudio: shot.generateAudio,
            returnLastFrame: true,
            references: references as unknown as Prisma.InputJsonValue,
          } as Prisma.InputJsonValue,
          costCredits: cost,
        },
      });
      return tx.shot.update({
        where: { id: shot.id },
        data: { videoTaskId: task.id },
        include: SHOT_INCLUDE,
      });
    });

    await enqueueTaskJob(queueForTaskType(TaskType.VIDEO), updatedShot.videoTaskId!);

    return c.json(await serializeShot(updatedShot));
  },
);

/**
 * Resolves the shot's characterStyleIds / sceneIds / itemIds (and optional
 * continuation source) into the VideoReference array the worker passes to the
 * Seedance provider.
 *
 * - CharacterStyle.assetId (when present) → reference_image
 * - Scene.assetId           → reference_image
 * - Item.assetId            → reference_image
 * - sketchAssetId           → reference_image
 * - When shotType='continuation' & preId set: the referenced shot's
 *   lastFrameAssetId → first_frame
 */
async function resolveReferences(
  shot: Awaited<ReturnType<typeof ownedShot>>,
): Promise<VideoReference[]> {
  const refs: VideoReference[] = [];

  const ids = {
    characterStyle: jsonArr(shot.characterStyleIds),
    scene: jsonArr(shot.sceneIds),
    item: jsonArr(shot.itemIds),
  };

  if (ids.characterStyle.length > 0) {
    const styles = await prisma.characterStyle.findMany({
      where: { id: { in: ids.characterStyle } },
      // Fall back to the parent character's avatar when the style itself has no
      // generated image — the reference picker shows `style.image || avatar`, so
      // a selection must always resolve to whatever image the user actually saw.
      select: { assetId: true, character: { select: { avatarAssetId: true } } },
    });
    for (const s of styles) {
      const assetId = s.assetId ?? s.character?.avatarAssetId ?? null;
      if (assetId) refs.push({ assetId, role: 'reference_image' });
    }
  }
  if (ids.scene.length > 0) {
    const scenes = await prisma.scene.findMany({
      where: { id: { in: ids.scene } },
      select: { assetId: true },
    });
    for (const s of scenes) {
      if (s.assetId) refs.push({ assetId: s.assetId, role: 'reference_image' });
    }
  }
  if (ids.item.length > 0) {
    const items = await prisma.item.findMany({
      where: { id: { in: ids.item } },
      select: { assetId: true },
    });
    for (const i of items) {
      if (i.assetId) refs.push({ assetId: i.assetId, role: 'reference_image' });
    }
  }
  if (shot.sketchAssetId) {
    refs.push({ assetId: shot.sketchAssetId, role: 'reference_image' });
  }

  if (shot.shotType === 'continuation' && shot.preId != null) {
    const pre = await prisma.shot.findFirst({
      where: { episodeId: shot.episodeId, displayId: shot.preId },
      select: { lastFrameAssetId: true },
    });
    if (pre?.lastFrameAssetId) {
      refs.push({ assetId: pre.lastFrameAssetId, role: 'first_frame' });
    }
  }

  return refs;
}

function jsonArr(v: unknown): string[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : [];
}

/**
 * Map UI-visible model id (one of MODEL_OPTIONS) → registered worker provider
 * name. Phase-1 ships only providers we actually have wired.
 */
function pickVideoProvider(uiModel: string): string {
  switch (uiModel) {
    case 'stub':
      return 'stub';
    case 'seedance-fast':
      return 'seedance-fast';
    case 'seedance':
    default:
      return 'seedance';
  }
}

/**
 * The provider's `pinnedModel` is the source of truth for the actual model
 * string sent to Volcengine. We pass an empty string so the provider falls
 * back to that default — the UI selector chooses provider, not model SKU.
 */
function modelIdForProvider(_provider: string, _uiModel: string): string {
  return '';
}
