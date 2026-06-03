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
  SetShotSketchSchema,
  UpdateShotSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';
import { TaskType, TaskStatus } from '@oneness/shared/enums';
import { estimateCost } from '@oneness/shared/pricing';
import { queueForTaskType } from '@oneness/shared/queues';
import { sanitizeShotVideoPrompt } from '@oneness/shared/shot-prompts';
import type { VideoReference } from '@oneness/shared/providers';
import { reconcileShotSketchTasksForEpisode } from '../lib/shot-sketches.js';

export const shotRoutes = new Hono();

shotRoutes.use('/projects/:id/episodes/:episodeId/shots', tryReadUser, requireUser);
shotRoutes.use('/shots/:id', tryReadUser, requireUser);
shotRoutes.use('/shots/:id/*', tryReadUser, requireUser);

const SHOT_INCLUDE = {
  sketch: true,
  sketchTask: true,
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

async function assertAccessibleProjectAsset(assetId: string, projectId: string, userId: string) {
  const asset = await prisma.asset.findFirst({
    where: {
      id: assetId,
      ownerId: userId,
      OR: [
        { taskAssets: { some: { task: { projectId } } } },
        { resourceImages: { some: { projectId } } },
        { characterAvatars: { some: { projectId } } },
        { characterIdentities: { some: { projectId } } },
        { characterStyles: { some: { character: { projectId } } } },
        { scenes: { some: { projectId } } },
        { items: { some: { projectId } } },
        { compositionTaskImages: { some: { projectId } } },
        { compositionTaskGrids: { some: { projectId } } },
        { compositionImageRunOutputs: { some: { task: { projectId } } } },
        { compositionGridRunOutputs: { some: { task: { projectId } } } },
        { compositionCandidates: { some: { task: { projectId } } } },
        { shotSketchRunOutputs: { some: { projectId } } },
        { shotSketchRunSources: { some: { projectId } } },
      ],
    },
    select: { id: true },
  });
  if (!asset) throw AppError.notFound(ErrorCodes.ASSET_NOT_FOUND, 'asset not found');
}

// GET /api/projects/:id/episodes/:episodeId/shots
shotRoutes.get('/projects/:id/episodes/:episodeId/shots', async (c) => {
  const user = c.var.user!;
  const projectId = c.req.param('id');
  const episodeId = c.req.param('episodeId');
  await ownedEpisode(projectId, episodeId, user.id);
  await reconcileShotSketchTasksForEpisode(prisma, episodeId);
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
          prompt: sanitizeShotVideoPrompt(body.prompt),
          model: body.model,
          ratio: body.ratio,
          resolution: body.resolution,
          generateAudio: body.generateAudio,
          createType: 'manual',
          characterStyleIds: body.characterStyleIds as Prisma.InputJsonValue,
          sceneIds: body.sceneIds as Prisma.InputJsonValue,
          itemIds: body.itemIds as Prisma.InputJsonValue,
          compositionTaskIds: body.compositionTaskIds as Prisma.InputJsonValue,
        },
        include: SHOT_INCLUDE,
      });
    });

    return c.json(await serializeShot(created), 201);
  },
);

// PATCH /api/shots/:id/sketch
shotRoutes.patch(
  '/shots/:id/sketch',
  zValidator('param', IdParamSchema),
  zValidator('json', SetShotSketchSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const shot = await ownedShot(id, user.id);

    if (body.assetId) {
      await assertAccessibleProjectAsset(body.assetId, shot.episode.projectId, user.id);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const nextShot = await tx.shot.update({
        where: { id },
        data: {
          sketchAssetId: body.assetId,
          sketchTaskId: null,
        },
        include: SHOT_INCLUDE,
      });
      if (body.assetId) {
        await tx.shotSketchRun.create({
          data: {
            projectId: shot.episode.projectId,
            episodeId: shot.episode.id,
            shotId: shot.id,
            source: body.source ?? 'manual',
            prompt: '',
            referenceAssetIds: [],
            params: {},
            status: 'APPLIED',
            outputAssetId: body.assetId,
            sourceAssetId: body.assetId,
          },
        });
      }
      return nextShot;
    });
    return c.json(await serializeShot(updated));
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
    const shot = await ownedShot(id, user.id);
    if (body.sketchAssetId) {
      await assertAccessibleProjectAsset(body.sketchAssetId, shot.episode.projectId, user.id);
    }

    const data: Prisma.ShotUpdateInput = {};
    if (body.shotType !== undefined) data.shotType = body.shotType;
    if (body.preId !== undefined) data.preId = body.preId;
    if (body.duration !== undefined) data.duration = body.duration;
    if (body.prompt !== undefined) data.prompt = sanitizeShotVideoPrompt(body.prompt);
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
    if (body.compositionTaskIds !== undefined)
      data.compositionTaskIds = body.compositionTaskIds as Prisma.InputJsonValue;

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
    if (!shot.sketchAssetId) {
      throw AppError.badRequest(
        ErrorCodes.VALIDATION_FAILED,
        'shot sketch is required before generating video',
      );
    }

    const references: VideoReference[] = await resolveReferences(shot);

    const provider = pickVideoProvider(shot.model);
    assertVideoProviderConfigured(provider);
    assertVideoReferencesReachable(provider, references);
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
            prompt: sanitizeShotVideoPrompt(shot.prompt),
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
 * Resolves the shot card's visible references into the VideoReference array
 * the worker passes to the video provider.
 *
 * Keep this aligned with ShotCard.buildReferenceThumbs:
 * - sketchAssetId is the visible main storyboard image and always comes first.
 * - CompositionTask current image → one reference_image per visible card.
 * - CharacterStyle.assetId        → one reference_image per visible style card.
 * - Scene.assetId                 → one reference_image per visible scene card.
 * - Item.assetId                  → one reference_image per visible item card.
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
    compositionTask: jsonArr(shot.compositionTaskIds),
  };

  if (shot.sketchAssetId) {
    refs.push({ assetId: shot.sketchAssetId, role: 'reference_image' });
  }

  if (ids.compositionTask.length > 0) {
    const compositionTasks = await prisma.compositionTask.findMany({
      where: { id: { in: ids.compositionTask }, projectId: shot.episode.projectId },
      select: {
        id: true,
        imageAssetId: true,
        currentImageRun: {
          select: {
            outputAssetId: true,
            taskJob: {
              select: {
                assets: {
                  where: { role: 'output' },
                  select: { assetId: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    const byId = new Map(compositionTasks.map((task) => [task.id, task]));
    for (const taskId of ids.compositionTask) {
      const task = byId.get(taskId);
      const assetId =
        task?.currentImageRun?.outputAssetId ??
        task?.currentImageRun?.taskJob?.assets[0]?.assetId ??
        task?.imageAssetId ??
        null;
      if (assetId) refs.push({ assetId, role: 'reference_image' });
    }
  }

  if (ids.characterStyle.length > 0) {
    const styles = await prisma.characterStyle.findMany({
      where: { id: { in: ids.characterStyle } },
      select: { id: true, assetId: true },
    });
    const byId = new Map(styles.map((style) => [style.id, style]));
    for (const styleId of ids.characterStyle) {
      const assetId = byId.get(styleId)?.assetId ?? null;
      if (assetId) refs.push({ assetId, role: 'reference_image' });
    }
  }
  if (ids.scene.length > 0) {
    const scenes = await prisma.scene.findMany({
      where: { id: { in: ids.scene } },
      select: { id: true, assetId: true },
    });
    const byId = new Map(scenes.map((scene) => [scene.id, scene]));
    for (const sceneId of ids.scene) {
      const assetId = byId.get(sceneId)?.assetId ?? null;
      if (assetId) refs.push({ assetId, role: 'reference_image' });
    }
  }
  if (ids.item.length > 0) {
    const items = await prisma.item.findMany({
      where: { id: { in: ids.item } },
      select: { id: true, assetId: true },
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const itemId of ids.item) {
      const assetId = byId.get(itemId)?.assetId ?? null;
      if (assetId) refs.push({ assetId, role: 'reference_image' });
    }
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

  return dedupeVideoReferences(refs);
}

function jsonArr(v: unknown): string[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : [];
}

function dedupeVideoReferences(refs: VideoReference[]): VideoReference[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.role ?? 'reference_image'}:${ref.assetId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const SEEDANCE_PRO_MODEL = 'doubao-seedance-2-0-260128';
const SEEDANCE_FAST_MODEL = 'doubao-seedance-2-0-fast-260128';
const APISWEET_SEEDANCE_PRO_MODEL = 'apisweet/sd_2.0';
const APISWEET_SEEDANCE_FAST_MODEL = 'apisweet/sd_2.0_fast';
const APISWEET_SEEDANCE_1080P_MODEL = 'apisweet/sd_2.0_1080p';
const APISWEET_SEEDANCE_FAST_1080P_MODEL = 'apisweet/sd_2.0_fast_1080p';

/**
 * Map UI-visible model id (one of MODEL_OPTIONS) → registered worker provider
 * name. Phase-1 ships only providers we actually have wired.
 */
function pickVideoProvider(uiModel: string): string {
  switch (uiModel) {
    case 'stub/placeholder':
    case 'stub':
      return 'stub';
    case SEEDANCE_FAST_MODEL:
    case 'seedance-fast':
      return 'apisweet-seedance';
    case APISWEET_SEEDANCE_PRO_MODEL:
    case APISWEET_SEEDANCE_FAST_MODEL:
    case APISWEET_SEEDANCE_1080P_MODEL:
    case APISWEET_SEEDANCE_FAST_1080P_MODEL:
    case 'apisweet-seedance':
      return 'apisweet-seedance';
    case SEEDANCE_PRO_MODEL:
    case 'seedance':
    default:
      return 'apisweet-seedance';
  }
}

function assertVideoProviderConfigured(provider: string) {
  if (provider === 'apisweet-seedance' && !process.env.APISWEET_API_KEY?.trim()) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_FAILED,
      'APISWEET_API_KEY is not set; configure API Sweet before generating video',
    );
  }
}

function assertVideoReferencesReachable(provider: string, references: VideoReference[]) {
  if (provider === 'stub' || references.length === 0) return;
  const endpoint = config.MINIO_PUBLIC_ENDPOINT ?? config.MINIO_ENDPOINT;
  const host = new URL(endpoint).hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_FAILED,
      '视频生成使用了参考图，但当前素材地址是本地 localhost，外部视频服务无法访问。请配置 MINIO_PUBLIC_ENDPOINT 为公网可访问地址后重试。',
    );
  }
}

/**
 * Full Ark model IDs are passed through exactly; legacy selector shorthands
 * leave model blank so each provider can use its pinned default.
 */
function modelIdForProvider(_provider: string, uiModel: string): string {
  if (_provider === 'apisweet-seedance') {
    if (uiModel === SEEDANCE_PRO_MODEL || uiModel === 'seedance') return 'sd_2.0';
    if (uiModel === SEEDANCE_FAST_MODEL || uiModel === 'seedance-fast') return 'sd_2.0_fast';
    return uiModel.replace(/^apisweet\//u, '') || 'sd_2.0_fast';
  }
  if (uiModel === SEEDANCE_PRO_MODEL || uiModel === SEEDANCE_FAST_MODEL) {
    return uiModel;
  }
  return '';
}
