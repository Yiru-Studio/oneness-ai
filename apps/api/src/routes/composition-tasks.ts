import { Hono } from 'hono';
import { zValidator } from '../middleware/validator';
import { Prisma } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';
import sharp from 'sharp';
import { prisma } from '../lib/prisma.js';
import { minioClient, Buckets } from '../lib/minio.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { enqueueTaskJob, QueueJobPriority } from '../lib/queues.js';
import {
  serializeCompositionTask,
  serializeCompositionTaskRuns,
} from '../serializers/composition-task.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import { estimateCost } from '@oneness/shared/pricing';
import { queueForTaskType } from '@oneness/shared/queues';
import { TaskStatus, TaskType } from '@oneness/shared/enums';
import {
  AnalyzeCompositionTasksSchema,
  ApplyCompositionCandidatesSchema,
  GenerateCompositionGridSchema,
  GenerateCompositionImageSchema,
  GenerateShotSketchesSchema,
  IdParamSchema,
  UpdateCompositionTaskSchema,
  type ApplyCompositionCandidatesInput,
  type GenerateCompositionGridInput,
  type GenerateCompositionImageInput,
  type GenerateShotSketchesInput,
} from '@oneness/shared/schemas';
import { config } from '../config.js';

export const compositionTaskRoutes = new Hono();

compositionTaskRoutes.use('/projects/:id/composition-tasks', tryReadUser, requireUser);
compositionTaskRoutes.use('/projects/:id/composition-tasks/*', tryReadUser, requireUser);
compositionTaskRoutes.use('/composition-tasks/:id', tryReadUser, requireUser);
compositionTaskRoutes.use('/composition-tasks/:id/*', tryReadUser, requireUser);
compositionTaskRoutes.use('/composition-image-runs/:id', tryReadUser, requireUser);
compositionTaskRoutes.use('/composition-image-runs/:id/*', tryReadUser, requireUser);
compositionTaskRoutes.use('/composition-grid-runs/:id', tryReadUser, requireUser);
compositionTaskRoutes.use('/composition-grid-runs/:id/*', tryReadUser, requireUser);

const IMAGE_RUN_INCLUDE = {
  outputAsset: true,
  taskJob: { include: { assets: { include: { asset: true } } } },
} as const;

const GRID_RUN_INCLUDE = {
  gridAsset: true,
  taskJob: { include: { assets: { include: { asset: true } } } },
  candidates: { include: { asset: true }, orderBy: { gridIndex: 'asc' as const } },
} as const;

const COMPOSITION_INCLUDE = {
  imageAsset: true,
  imageTask: { include: { assets: { include: { asset: true } } } },
  gridAsset: true,
  currentImageRun: { include: IMAGE_RUN_INCLUDE },
  currentGridRun: { include: GRID_RUN_INCLUDE },
  candidates: { include: { asset: true }, orderBy: { gridIndex: 'asc' as const } },
  _count: { select: { imageRuns: true, gridRuns: true, candidates: true } },
} as const;

const ANGLE_LABELS = ['远景', '中景', '近景', '侧面', '正面', '背影', '俯拍', '仰拍', '特写'];

type EpisodeScene = {
  index: number;
  title: string;
  content: string;
  characters: string[];
  environment: string;
  referenceSceneId?: string;
};

type ReferenceLibrary = Awaited<ReturnType<typeof loadReferenceLibrary>>;

compositionTaskRoutes.get('/projects/:id/composition-tasks', async (c) => {
  const user = c.var.user!;
  const projectId = c.req.param('id');
  await assertOwnedProject(projectId, user.id);
  await refreshCompositionTasks(projectId);
  const rows = await prisma.compositionTask.findMany({
    where: { projectId },
    include: COMPOSITION_INCLUDE,
    orderBy: [{ episode: { number: 'asc' } }, { sceneIndex: 'asc' }],
  });
  return c.json(await Promise.all(rows.map(serializeCompositionTask)));
});

compositionTaskRoutes.post(
  '/projects/:id/composition-tasks/analyze',
  zValidator('json', AnalyzeCompositionTasksSchema),
  async (c) => {
    const user = c.var.user!;
    const projectId = c.req.param('id');
    const body = c.req.valid('json');
    const project = await assertOwnedProject(projectId, user.id);

    const episodes = await prisma.storyboardEpisode.findMany({
      where: { projectId, ...(body.episodeId ? { id: body.episodeId } : {}) },
      orderBy: { number: 'asc' },
    });
    if (episodes.length === 0) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '请先上传或创建剧集');
    }

    const library = await loadReferenceLibrary(projectId);
    await prisma.$transaction(async (tx) => {
      for (const episode of episodes) {
        for (const scene of scenesForEpisode(episode, library.scenes)) {
          const refs = prefillReferences(scene, library);
          const title = `第${episode.number}集 · ${scene.title || `场景 ${scene.index + 1}`}`;
          const where = {
            episodeId_sceneIndex: {
              episodeId: episode.id,
              sceneIndex: scene.index,
            },
          };
          const existing = await tx.compositionTask.findUnique({
            where,
            select: {
              id: true,
              status: true,
              currentImageRunId: true,
              imageAssetId: true,
              imageTaskId: true,
            },
          });
          if (!existing) {
            await tx.compositionTask.create({
              data: {
                projectId,
                episodeId: episode.id,
                sceneIndex: scene.index,
                title,
                scriptExcerpt: scene.content,
                prompt: buildCompositionPrompt(project, scene, refs),
                characterStyleIds: refs.characterStyleIds as Prisma.InputJsonValue,
                sceneIds: refs.sceneIds as Prisma.InputJsonValue,
                itemIds: refs.itemIds as Prisma.InputJsonValue,
              },
            });
            continue;
          }

          const canRefreshDraft =
            existing.status === 'DRAFT' &&
            !existing.currentImageRunId &&
            !existing.imageAssetId &&
            !existing.imageTaskId;
          await tx.compositionTask.update({
            where: { id: existing.id },
            data: {
              projectId,
              episodeId: episode.id,
              sceneIndex: scene.index,
              title,
              scriptExcerpt: scene.content,
              ...(canRefreshDraft
                ? {
                    prompt: buildCompositionPrompt(project, scene, refs),
                    characterStyleIds: refs.characterStyleIds as Prisma.InputJsonValue,
                    sceneIds: refs.sceneIds as Prisma.InputJsonValue,
                    itemIds: refs.itemIds as Prisma.InputJsonValue,
                  }
                : {}),
            },
          });
        }
      }
    });

    const rows = await prisma.compositionTask.findMany({
      where: { projectId },
      include: COMPOSITION_INCLUDE,
      orderBy: [{ episode: { number: 'asc' } }, { sceneIndex: 'asc' }],
    });
    return c.json(await Promise.all(rows.map(serializeCompositionTask)));
  },
);

compositionTaskRoutes.post(
  '/projects/:id/composition-tasks/generate-shot-sketches',
  zValidator('json', GenerateShotSketchesSchema),
  async (c) => {
    const user = c.var.user!;
    const projectId = c.req.param('id');
    const body = c.req.valid('json');
    const result = await createShotSketchTasks(projectId, user.id, body);
    return c.json(result, 201);
  },
);

compositionTaskRoutes.patch(
  '/composition-tasks/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateCompositionTaskSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await loadOwnedCompositionTask(id, user.id);

    if (body.characterStyleIds) {
      await assertAllCharacterStylesOwned(existing.projectId, body.characterStyleIds, user.id);
    }
    if (body.sceneIds) await assertAllScenesOwned(existing.projectId, body.sceneIds, user.id);
    if (body.itemIds) await assertAllItemsOwned(existing.projectId, body.itemIds, user.id);

    await prisma.$transaction(async (tx) => {
      const data: Prisma.CompositionTaskUpdateInput = {};
      if (body.prompt !== undefined) data.prompt = body.prompt;
      if (body.characterStyleIds !== undefined)
        data.characterStyleIds = body.characterStyleIds as Prisma.InputJsonValue;
      if (body.sceneIds !== undefined) data.sceneIds = body.sceneIds as Prisma.InputJsonValue;
      if (body.itemIds !== undefined) data.itemIds = body.itemIds as Prisma.InputJsonValue;
      if (Object.keys(data).length > 0) {
        await tx.compositionTask.update({ where: { id }, data });
      }
      if (body.selectedCandidateIds !== undefined) {
        await tx.compositionCandidate.updateMany({
          where: { taskId: id },
          data: { selected: false },
        });
        if (body.selectedCandidateIds.length > 0) {
          await tx.compositionCandidate.updateMany({
            where: { taskId: id, id: { in: body.selectedCandidateIds } },
            data: { selected: true },
          });
        }
      }
    });

    return c.json(await serializeCompositionTask(await loadCompositionTask(id)));
  },
);

compositionTaskRoutes.get(
  '/composition-tasks/:id/runs',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    await refreshCompositionTask(id);
    const row = await prisma.compositionTask.findFirst({
      where: { id, project: { ownerId: user.id } },
      select: {
        id: true,
        currentImageRunId: true,
        currentGridRunId: true,
        imageRuns: {
          include: IMAGE_RUN_INCLUDE,
          orderBy: { createdAt: 'desc' },
        },
        gridRuns: {
          include: GRID_RUN_INCLUDE,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!row) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'composition task not found');
    return c.json(await serializeCompositionTaskRuns(row));
  },
);

compositionTaskRoutes.post(
  '/composition-tasks/:id/generate-image',
  zValidator('param', IdParamSchema),
  zValidator('json', GenerateCompositionImageSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await createImageRunForTask(id, user.id, body);
    return c.json(await serializeCompositionTask(await loadCompositionTask(id)));
  },
);

compositionTaskRoutes.post(
  '/composition-image-runs/:id/set-current',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const row = await loadOwnedImageRun(id, user.id);
    const outputAssetId = row.outputAssetId ?? row.taskJob?.assets.find((a) => a.role === 'output')?.assetId ?? null;
    if (!outputAssetId) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '只能将已生成成功的镜头图设为当前结果');
    }
    const latestGrid = await prisma.compositionGridRun.findFirst({
      where: { imageRunId: row.id, gridAssetId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, gridAssetId: true },
    });
    await prisma.compositionTask.update({
      where: { id: row.taskId },
      data: {
        currentImageRunId: row.id,
        currentGridRunId: latestGrid?.id ?? null,
        imageAssetId: outputAssetId,
        imageTaskId: row.taskJobId,
        gridAssetId: latestGrid?.gridAssetId ?? null,
        syncedAt: null,
      },
    });
    await syncTaskCurrentStatus(row.taskId);
    return c.json(await serializeCompositionTask(await loadCompositionTask(row.taskId)));
  },
);

compositionTaskRoutes.post(
  '/composition-image-runs/:id/generate-grid',
  zValidator('param', IdParamSchema),
  zValidator('json', GenerateCompositionGridSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const taskId = await createGridRunForImageRun(id, user.id, body);
    return c.json(await serializeCompositionTask(await loadCompositionTask(taskId)));
  },
);

compositionTaskRoutes.post(
  '/composition-grid-runs/:id/set-current',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const row = await loadOwnedGridRun(id, user.id);
    const gridAssetId = row.gridAssetId ?? row.taskJob?.assets.find((a) => a.role === 'output')?.assetId ?? null;
    if (!gridAssetId || row.candidates.length === 0) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '只能将已生成成功的分镜网格设为当前结果');
    }
    const imageOutputAssetId =
      row.imageRun.outputAssetId ??
      row.imageRun.taskJob?.assets.find((a) => a.role === 'output')?.assetId ??
      null;
    await prisma.compositionTask.update({
      where: { id: row.taskId },
      data: {
        currentImageRunId: row.imageRunId,
        currentGridRunId: row.id,
        imageAssetId: imageOutputAssetId,
        imageTaskId: row.imageRun.taskJobId,
        gridAssetId,
        gridTaskId: row.taskJobId,
        status: 'GRID_READY',
        error: null,
        syncedAt: null,
      },
    });
    await syncTaskCurrentStatus(row.taskId);
    return c.json(await serializeCompositionTask(await loadCompositionTask(row.taskId)));
  },
);

// Backward-compatible wrapper for the phase-1 UI route.
compositionTaskRoutes.post(
  '/composition-tasks/:id/generate-grid',
  zValidator('param', IdParamSchema),
  zValidator('json', GenerateCompositionGridSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const row = await loadOwnedCompositionTask(id, user.id);
    if (!row.currentImageRunId) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '请先生成合成镜头图，再生成分镜网格');
    }
    const taskId = await createGridRunForImageRun(row.currentImageRunId, user.id, body);
    return c.json(await serializeCompositionTask(await loadCompositionTask(taskId)));
  },
);

compositionTaskRoutes.post(
  '/composition-grid-runs/:id/apply-to-shots',
  zValidator('param', IdParamSchema),
  zValidator('json', ApplyCompositionCandidatesSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const taskId = await applyGridRunToShots(id, user.id, body);
    return c.json(await serializeCompositionTask(await loadCompositionTask(taskId)));
  },
);

// Backward-compatible wrapper for the phase-1 UI route.
compositionTaskRoutes.post(
  '/composition-tasks/:id/sync-to-shots',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const row = await loadOwnedCompositionTask(id, user.id);
    if (!row.currentGridRunId) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '请先生成分镜网格');
    }
    const selectedCandidateIds = row.currentGridRun?.candidates
      .filter((candidate) => candidate.selected)
      .map((candidate) => candidate.id) ?? [];
    const taskId = await applyGridRunToShots(row.currentGridRunId, user.id, {
      mode: 'create_shots',
      candidateIds: selectedCandidateIds,
    });
    return c.json(await serializeCompositionTask(await loadCompositionTask(taskId)));
  },
);

async function createImageRunForTask(
  taskId: string,
  userId: string,
  body: GenerateCompositionImageInput,
): Promise<string> {
  const row = await loadOwnedCompositionTask(taskId, userId);
  if (!row.prompt.trim()) {
    throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '合成镜头提示词不能为空');
  }
  const project = await assertOwnedProject(row.projectId, userId);
  const settings = normalizeImageSettings(project, body);
  const referenceAssetIds = await resolveReferenceAssetIds(row.projectId, {
    characterStyleIds: jsonStringArray(row.characterStyleIds),
    sceneIds: jsonStringArray(row.sceneIds),
    itemIds: jsonStringArray(row.itemIds),
  });
  const cost = estimateCost(TaskType.IMAGE) * settings.outputCount;
  const provider = providerForImageModel(settings.model);
  const prompt = body.negativePrompt
    ? `${row.prompt}\n\nNegative prompt:\n${body.negativePrompt}`
    : row.prompt;

  const task = await prisma.$transaction(async (tx) => {
    const account = await tx.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    if (!account) throw AppError.unauthorized();
    if (account.credits < cost) {
      throw AppError.badRequest(
        ErrorCodes.INSUFFICIENT_CREDITS,
        `requires ${cost} credits, have ${account.credits}`,
        { required: cost, available: account.credits },
      );
    }
    await tx.user.update({ where: { id: userId }, data: { credits: { decrement: cost } } });
    const job = await tx.task.create({
      data: {
        ownerId: userId,
        projectId: row.projectId,
        type: TaskType.IMAGE,
        provider,
        status: TaskStatus.QUEUED,
        costCredits: cost,
        input: {
          prompt,
          ratio: settings.ratio,
          model: settings.model,
          referenceAssetIds,
          n: settings.outputCount,
          quality: settings.quality,
          seed: settings.seed ?? undefined,
        } as Prisma.InputJsonValue,
      },
    });
    const run = await tx.compositionImageRun.create({
      data: {
        taskId: row.id,
        prompt: row.prompt,
        negativePrompt: settings.negativePrompt,
        model: settings.model,
        ratio: settings.ratio,
        quality: settings.quality,
        outputCount: settings.outputCount,
        seed: settings.seed,
        characterConsistency: settings.characterConsistency,
        sceneConsistency: settings.sceneConsistency,
        itemConsistency: settings.itemConsistency,
        referenceAssetIds: referenceAssetIds as Prisma.InputJsonValue,
        characterStyleIds: row.characterStyleIds as Prisma.InputJsonValue,
        sceneIds: row.sceneIds as Prisma.InputJsonValue,
        itemIds: row.itemIds as Prisma.InputJsonValue,
        params: settings as Prisma.InputJsonValue,
        status: 'QUEUED',
        costCredits: cost,
        taskJobId: job.id,
      },
    });
    await tx.compositionTask.update({
      where: { id: row.id },
      data: {
        currentImageRunId: run.id,
        currentGridRunId: null,
        imageTaskId: job.id,
        imageAssetId: null,
        gridAssetId: null,
        status: 'IMAGE_QUEUED',
        error: null,
        syncedAt: null,
      },
    });
    return job;
  });

  await enqueueTaskJob(queueForTaskType(TaskType.IMAGE), task.id, {
    priority: QueueJobPriority.INTERACTIVE_IMAGE,
  });
  return row.id;
}

async function createGridRunForImageRun(
  imageRunId: string,
  userId: string,
  body: GenerateCompositionGridInput,
): Promise<string> {
  const imageRun = await loadOwnedImageRun(imageRunId, userId);
  const project = await assertOwnedProject(imageRun.task.projectId, userId);
  const source = imageRun.outputAsset ?? imageRun.taskJob?.assets.find((a) => a.role === 'output')?.asset ?? null;
  if (!source) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_FAILED,
      '请先等待合成镜头图生成完成，再生成分镜网格',
    );
  }
  const settings = normalizeGridSettings(project, imageRun, body);
  const cost = estimateCost(TaskType.IMAGE);
  const provider = providerForImageModel(settings.model);
  const prompt = buildGridPrompt(project, imageRun, settings);

  const task = await prisma.$transaction(async (tx) => {
    const account = await tx.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    if (!account) throw AppError.unauthorized();
    if (account.credits < cost) {
      throw AppError.badRequest(
        ErrorCodes.INSUFFICIENT_CREDITS,
        `requires ${cost} credits, have ${account.credits}`,
        { required: cost, available: account.credits },
      );
    }
    await tx.user.update({ where: { id: userId }, data: { credits: { decrement: cost } } });
    const job = await tx.task.create({
      data: {
        ownerId: userId,
        projectId: imageRun.task.projectId,
        type: TaskType.IMAGE,
        provider,
        status: TaskStatus.QUEUED,
        costCredits: cost,
        input: {
          prompt,
          ratio: settings.ratio,
          model: settings.model,
          referenceAssetIds: [source.id],
          n: 1,
          compositionGridRun: true,
        } as Prisma.InputJsonValue,
      },
    });
    const gridRun = await tx.compositionGridRun.create({
      data: {
        taskId: imageRun.taskId,
        imageRunId: imageRun.id,
        model: settings.model,
        ratio: settings.ratio,
        specification: settings.specification,
        variationMode: settings.variationMode,
        consistency: settings.consistency,
        inheritStyle: settings.inheritStyle,
        inheritSeed: settings.inheritSeed,
        params: settings as Prisma.InputJsonValue,
        status: 'QUEUED',
        costCredits: cost,
        taskJobId: job.id,
      },
    });
    await tx.compositionTask.update({
      where: { id: imageRun.taskId },
      data: {
        currentImageRunId: imageRun.id,
        currentGridRunId: gridRun.id,
        gridTaskId: job.id,
        gridAssetId: null,
        status: 'GRID_QUEUED',
        error: null,
        syncedAt: null,
      },
    });
    return job;
  });

  await enqueueTaskJob(queueForTaskType(TaskType.IMAGE), task.id, {
    priority: QueueJobPriority.INTERACTIVE_IMAGE,
  });
  return imageRun.taskId;
}

async function applyGridRunToShots(
  gridRunId: string,
  userId: string,
  body: ApplyCompositionCandidatesInput,
): Promise<string> {
  const gridRun = await loadOwnedGridRun(gridRunId, userId);
  const selected = gridRun.candidates
    .filter((candidate) => body.candidateIds.includes(candidate.id) && candidate.assetId)
    .sort((a, b) => a.gridIndex - b.gridIndex);
  if (selected.length === 0) {
    throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '请先选择至少一张分镜候选图');
  }
  const project = gridRun.task.project;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    if (body.mode === 'add_to_storyboard_assets') {
      await tx.compositionCandidate.updateMany({
        where: { id: { in: selected.map((candidate) => candidate.id) } },
        data: { selected: true, status: 'APPLIED', appliedMode: body.mode, appliedAt: now },
      });
    } else if (body.mode === 'replace_existing_shots') {
      const targetShots = body.targetShotIds?.length
        ? await tx.shot.findMany({
            where: {
              id: { in: body.targetShotIds },
              episodeId: gridRun.task.episodeId,
              episode: { project: { ownerId: userId } },
            },
            orderBy: { displayId: 'asc' },
          })
        : await tx.shot.findMany({
            where: {
              episodeId: gridRun.task.episodeId,
              sceneIndex: gridRun.task.sceneIndex,
            },
            orderBy: { displayId: 'asc' },
            take: selected.length,
          });
      if (targetShots.length < selected.length) {
        throw AppError.badRequest(
          ErrorCodes.VALIDATION_FAILED,
          '可替换的现有分镜数量不足，请减少候选图或改为创建新 Shot',
        );
      }
      for (const [index, candidate] of selected.entries()) {
        const shot = targetShots[index]!;
        await tx.shot.update({
          where: { id: shot.id },
          data: {
            sketchAssetId: candidate.assetId,
            characterStyleIds: gridRun.task.characterStyleIds as Prisma.InputJsonValue,
            sceneIds: gridRun.task.sceneIds as Prisma.InputJsonValue,
            itemIds: gridRun.task.itemIds as Prisma.InputJsonValue,
          },
        });
        await tx.compositionCandidate.update({
          where: { id: candidate.id },
          data: {
            selected: true,
            syncedShotId: shot.id,
            status: 'APPLIED',
            appliedMode: body.mode,
            appliedAt: now,
          },
        });
      }
    } else {
      const maxShot = await tx.shot.findFirst({
        where: { episodeId: gridRun.task.episodeId },
        orderBy: { displayId: 'desc' },
        select: { displayId: true },
      });
      let nextDisplayId = (maxShot?.displayId ?? 0) + 1;
      for (const candidate of selected) {
        if (candidate.syncedShotId) continue;
        const shot = await tx.shot.create({
          data: {
            episodeId: gridRun.task.episodeId,
            displayId: nextDisplayId++,
            sceneIndex: gridRun.task.sceneIndex,
            shotType: 'new',
            duration: 4,
            prompt: `${gridRun.task.prompt}\n\n候选分镜：第 ${candidate.gridIndex} 格（${candidate.angleLabel ?? '候选'}）。`,
            model: project.videoModel,
            ratio: project.ratio,
            resolution: '720p',
            generateAudio: true,
            createType: 'manual',
            sketchAssetId: candidate.assetId,
            characterStyleIds: gridRun.task.characterStyleIds as Prisma.InputJsonValue,
            sceneIds: gridRun.task.sceneIds as Prisma.InputJsonValue,
            itemIds: gridRun.task.itemIds as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        await tx.compositionCandidate.update({
          where: { id: candidate.id },
          data: {
            selected: true,
            syncedShotId: shot.id,
            status: 'APPLIED',
            appliedMode: body.mode,
            appliedAt: now,
          },
        });
      }
    }
    await tx.compositionTask.update({
      where: { id: gridRun.taskId },
      data: { status: 'APPLIED', syncedAt: now },
    });
  });

  return gridRun.taskId;
}

async function createShotSketchTasks(
  projectId: string,
  userId: string,
  body: GenerateShotSketchesInput,
) {
  const project = await assertOwnedProject(projectId, userId);
  const episode = await prisma.storyboardEpisode.findFirst({
    where: { id: body.episodeId, projectId },
    select: { id: true, number: true, title: true, content: true, scenesJson: true },
  });
  if (!episode) {
    throw AppError.notFound(ErrorCodes.EPISODE_NOT_FOUND, 'episode not found');
  }

  const library = await loadReferenceLibrary(projectId);
  const scene = scenesForEpisode(episode, library.scenes).find((item) => item.index === body.sceneIndex);
  if (!scene) {
    throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'sceneIndex out of range');
  }

  const compositionTaskId = await ensureCompositionTaskForScene(project, episode, scene, library);
  const compositionTask = await loadCompositionTask(compositionTaskId);
  const compositionImageAssetId = currentCompositionImageAssetId(compositionTask);

  const shots = await prisma.shot.findMany({
    where: {
      episodeId: body.episodeId,
      sceneIndex: body.sceneIndex,
      createType: 'assist',
      episode: { project: { ownerId: userId } },
    },
    include: { sketchTask: true },
    orderBy: { displayId: 'asc' },
  });
  const targetShots = shots.filter((shot) => shouldCreateShotSketch(shot, body.force));
  const skippedShotIds = shots
    .filter((shot) => !targetShots.some((target) => target.id === shot.id))
    .map((shot) => shot.id);

  if (targetShots.length === 0) {
    return {
      compositionTaskId,
      createdTaskIds: [] as string[],
      targetShotIds: [] as string[],
      skippedShotIds,
      createdCount: 0,
      skippedCount: skippedShotIds.length,
    };
  }

  const workItems = await Promise.all(
    targetShots.map(async (shot) => {
      const referenceAssetIds = await buildShotSketchReferenceAssetIds(projectId, compositionTask, shot, compositionImageAssetId);
      return {
        shotId: shot.id,
        prompt: buildShotSketchPrompt(project, scene, shot, Boolean(compositionImageAssetId)),
        referenceAssetIds,
      };
    }),
  );

  const costPerTask = estimateCost(TaskType.IMAGE);
  const totalCost = costPerTask * workItems.length;
  const provider = providerForImageModel(project.imageModel);

  const createdTaskIds = await prisma.$transaction(async (tx) => {
    const account = await tx.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    if (!account) throw AppError.unauthorized();
    if (account.credits < totalCost) {
      throw AppError.badRequest(
        ErrorCodes.INSUFFICIENT_CREDITS,
        `requires ${totalCost} credits, have ${account.credits}`,
        { required: totalCost, available: account.credits },
      );
    }
    await tx.user.update({ where: { id: userId }, data: { credits: { decrement: totalCost } } });

    const ids: string[] = [];
    for (const item of workItems) {
      const job = await tx.task.create({
        data: {
          ownerId: userId,
          projectId,
          type: TaskType.IMAGE,
          provider,
          status: TaskStatus.QUEUED,
          costCredits: costPerTask,
          input: {
            prompt: item.prompt,
            ratio: project.ratio,
            model: project.imageModel,
            referenceAssetIds: item.referenceAssetIds,
            n: 1,
            shotSketch: true,
            shotId: item.shotId,
            compositionTaskId,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.shot.update({
        where: { id: item.shotId },
        data: { sketchTaskId: job.id },
      });
      ids.push(job.id);
    }
    return ids;
  });

  await Promise.all(
    createdTaskIds.map((taskId) =>
      enqueueTaskJob(queueForTaskType(TaskType.IMAGE), taskId, {
        priority: QueueJobPriority.INTERACTIVE_IMAGE,
      }),
    ),
  );

  return {
    compositionTaskId,
    createdTaskIds,
    targetShotIds: targetShots.map((shot) => shot.id),
    skippedShotIds,
    createdCount: createdTaskIds.length,
    skippedCount: skippedShotIds.length,
  };
}

async function assertOwnedProject(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId: userId } });
  if (!project) throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
  return project;
}

async function loadOwnedCompositionTask(id: string, userId: string) {
  await refreshCompositionTask(id);
  const row = await prisma.compositionTask.findFirst({
    where: { id, project: { ownerId: userId } },
    include: COMPOSITION_INCLUDE,
  });
  if (!row) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'composition task not found');
  return row;
}

async function loadCompositionTask(id: string) {
  await refreshCompositionTask(id);
  const row = await prisma.compositionTask.findUnique({
    where: { id },
    include: COMPOSITION_INCLUDE,
  });
  if (!row) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'composition task not found');
  return row;
}

async function loadOwnedImageRun(id: string, userId: string) {
  await refreshCompositionImageRun(id);
  const row = await prisma.compositionImageRun.findFirst({
    where: { id, task: { project: { ownerId: userId } } },
    include: {
      ...IMAGE_RUN_INCLUDE,
      task: { include: { project: true } },
    },
  });
  if (!row) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'composition image run not found');
  return row;
}

async function loadOwnedGridRun(id: string, userId: string) {
  await refreshCompositionGridRun(id);
  const row = await prisma.compositionGridRun.findFirst({
    where: { id, task: { project: { ownerId: userId } } },
    include: {
      ...GRID_RUN_INCLUDE,
      imageRun: { include: IMAGE_RUN_INCLUDE },
      task: { include: { project: true } },
    },
  });
  if (!row) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'composition grid run not found');
  return row;
}

async function refreshCompositionTasks(projectId: string) {
  const [imageRows, gridRows] = await Promise.all([
    prisma.compositionImageRun.findMany({
      where: { task: { projectId }, taskJobId: { not: null } },
      select: { id: true },
    }),
    prisma.compositionGridRun.findMany({
      where: { task: { projectId }, taskJobId: { not: null } },
      select: { id: true },
    }),
  ]);
  await Promise.all([
    ...imageRows.map((row) => refreshCompositionImageRun(row.id)),
    ...gridRows.map((row) => refreshCompositionGridRun(row.id)),
  ]);
}

async function refreshCompositionTask(id: string) {
  const [imageRows, gridRows] = await Promise.all([
    prisma.compositionImageRun.findMany({
      where: { taskId: id, taskJobId: { not: null } },
      select: { id: true },
    }),
    prisma.compositionGridRun.findMany({
      where: { taskId: id, taskJobId: { not: null } },
      select: { id: true },
    }),
  ]);
  await Promise.all([
    ...imageRows.map((row) => refreshCompositionImageRun(row.id)),
    ...gridRows.map((row) => refreshCompositionGridRun(row.id)),
  ]);
  await syncTaskCurrentStatus(id);
}

async function refreshCompositionGridRun(id: string) {
  const run = await prisma.compositionGridRun.findUnique({
    where: { id },
    include: {
      taskJob: { include: { assets: { include: { asset: true } } } },
      task: { select: { id: true, currentGridRunId: true } },
      candidates: true,
    },
  });
  if (!run?.taskJob) return;

  const output = run.taskJob.assets.find((a) => a.role === 'output');
  if (run.taskJob.status === TaskStatus.SUCCEEDED && output) {
    await finalizeCompositionGridRun(run, output.asset);
    return;
  }

  const data: Prisma.CompositionGridRunUpdateInput = {};
  if (run.taskJob.status === TaskStatus.FAILED || run.taskJob.status === TaskStatus.CANCELLED) {
    data.status = run.taskJob.status;
    data.error = run.taskJob.error;
  } else if (run.taskJob.status === TaskStatus.RUNNING || run.taskJob.status === TaskStatus.QUEUED) {
    data.status = run.taskJob.status;
  }
  if (Object.keys(data).length > 0) {
    await prisma.compositionGridRun.update({ where: { id }, data });
  }
  if (run.task.currentGridRunId === id) {
    await syncTaskCurrentStatus(run.task.id);
  }
}

async function finalizeCompositionGridRun(
  run: {
    id: string;
    taskId: string;
    gridAssetId: string | null;
    candidates: Array<{ id: string }>;
    task: { id: string; currentGridRunId: string | null };
  },
  gridAsset: { id: string; ownerId: string; bucket: string; key: string },
) {
  if (run.gridAssetId && run.candidates.length >= 9) return;

  const gridBuffer = await readAssetBuffer(gridAsset.bucket, gridAsset.key);
  const candidateBuffers = await splitGridCandidates(gridBuffer);
  const candidateAssets = await Promise.all(
    candidateBuffers.map((buf, index) =>
      uploadGeneratedAsset(gridAsset.ownerId, run.taskId, `candidate-${index + 1}`, buf),
    ),
  );

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.compositionGridRun.findUnique({
      where: { id: run.id },
      include: { candidates: true, task: { select: { currentGridRunId: true } } },
    });
    if (!fresh) return;
    if (fresh.gridAssetId && fresh.candidates.length >= 9) return;

    await tx.compositionCandidate.deleteMany({ where: { gridRunId: run.id } });
    for (const asset of candidateAssets) {
      await tx.asset.create({ data: asset });
    }
    for (const [index, asset] of candidateAssets.entries()) {
      await tx.compositionCandidate.create({
        data: {
          taskId: run.taskId,
          gridRunId: run.id,
          gridIndex: index + 1,
          angleLabel: ANGLE_LABELS[index] ?? `候选 ${index + 1}`,
          assetId: asset.id,
          selected: false,
          status: 'READY',
        },
      });
    }
    await tx.compositionGridRun.update({
      where: { id: run.id },
      data: {
        gridAssetId: gridAsset.id,
        status: 'READY',
        error: null,
      },
    });
    if (fresh.task.currentGridRunId === run.id) {
      await tx.compositionTask.update({
        where: { id: run.taskId },
        data: {
          gridAssetId: gridAsset.id,
          status: 'GRID_READY',
          error: null,
        },
      });
    }
  });

  if (run.task.currentGridRunId === run.id) {
    await syncTaskCurrentStatus(run.task.id);
  }
}

async function refreshCompositionImageRun(id: string) {
  const run = await prisma.compositionImageRun.findUnique({
    where: { id },
    include: {
      taskJob: { include: { assets: { include: { asset: true } } } },
      task: { select: { id: true, currentImageRunId: true } },
    },
  });
  if (!run?.taskJob) return;
  const output = run.taskJob.assets.find((a) => a.role === 'output');
  const data: Prisma.CompositionImageRunUpdateInput = {};
  if (run.taskJob.status === TaskStatus.SUCCEEDED && output) {
    data.outputAsset = { connect: { id: output.assetId } };
    data.status = 'SUCCEEDED';
    data.error = null;
  } else if (run.taskJob.status === TaskStatus.FAILED || run.taskJob.status === TaskStatus.CANCELLED) {
    data.status = run.taskJob.status;
    data.error = run.taskJob.error;
  } else if (run.taskJob.status === TaskStatus.RUNNING || run.taskJob.status === TaskStatus.QUEUED) {
    data.status = run.taskJob.status;
  }
  if (Object.keys(data).length > 0) {
    await prisma.compositionImageRun.update({ where: { id }, data });
  }
  if (run.task.currentImageRunId === id) {
    await syncTaskCurrentStatus(run.task.id);
  }
}

async function syncTaskCurrentStatus(taskId: string) {
  const row = await prisma.compositionTask.findUnique({
    where: { id: taskId },
    include: {
      currentImageRun: { include: IMAGE_RUN_INCLUDE },
      currentGridRun: { include: GRID_RUN_INCLUDE },
    },
  });
  if (!row) return;
  const imageOutputAssetId =
    row.currentImageRun?.outputAssetId ??
    row.currentImageRun?.taskJob?.assets.find((asset) => asset.role === 'output')?.assetId ??
    null;
  const hasApplied = row.currentGridRun?.candidates.some((candidate) => candidate.status === 'APPLIED' || candidate.syncedShotId) ?? false;
  const gridOutputAssetId =
    row.currentGridRun?.gridAssetId ??
    row.currentGridRun?.taskJob?.assets.find((asset) => asset.role === 'output')?.assetId ??
    null;
  const hasGrid = Boolean(gridOutputAssetId || row.currentGridRun?.candidates.length);
  const gridStatus = row.currentGridRun?.taskJob?.status ?? row.currentGridRun?.status ?? null;
  let status = 'DRAFT';
  let error: string | null = null;
  if (hasApplied) {
    status = 'APPLIED';
  } else if (hasGrid) {
    status = 'GRID_READY';
  } else if (gridStatus === TaskStatus.FAILED || gridStatus === TaskStatus.CANCELLED) {
    status = 'GRID_FAILED';
    error = row.currentGridRun?.error ?? row.currentGridRun?.taskJob?.error ?? null;
  } else if (gridStatus === TaskStatus.RUNNING) {
    status = 'GRID_RUNNING';
  } else if (gridStatus === TaskStatus.QUEUED) {
    status = 'GRID_QUEUED';
  } else if (imageOutputAssetId) {
    status = 'IMAGE_READY';
  } else if (row.currentImageRun?.status === 'FAILED' || row.currentImageRun?.status === 'CANCELLED') {
    status = 'IMAGE_FAILED';
    error = row.currentImageRun.error;
  } else if (row.currentImageRun?.status === 'RUNNING') {
    status = 'IMAGE_RUNNING';
  } else if (row.currentImageRun?.status === 'QUEUED') {
    status = 'IMAGE_QUEUED';
  }
  await prisma.compositionTask.update({
    where: { id: taskId },
    data: {
      status,
      error,
      imageAssetId: imageOutputAssetId,
      imageTaskId: row.currentImageRun?.taskJobId ?? null,
      gridAssetId: gridOutputAssetId,
      gridTaskId: row.currentGridRun?.taskJobId ?? null,
    },
  });
}

function normalizeImageSettings(
  project: { imageModel: string; ratio: string },
  body: GenerateCompositionImageInput,
) {
  return {
    model: body.model ?? project.imageModel,
    ratio: body.ratio ?? project.ratio,
    quality: body.quality ?? '1080p',
    outputCount: body.outputCount ?? 1,
    seed: body.seed?.trim() ? body.seed.trim() : null,
    characterConsistency: body.characterConsistency ?? 50,
    sceneConsistency: body.sceneConsistency ?? 50,
    itemConsistency: body.itemConsistency ?? 50,
    negativePrompt: body.negativePrompt ?? '',
  };
}

function normalizeGridSettings(
  project: { imageModel: string; ratio: string },
  imageRun: { model: string; ratio: string },
  body: GenerateCompositionGridInput,
) {
  return {
    model: body.model ?? imageRun.model ?? project.imageModel,
    ratio: body.ratio ?? imageRun.ratio ?? project.ratio,
    specification: body.specification ?? '3x3',
    variationMode: body.variationMode ?? 'auto_angles',
    consistency: body.consistency ?? 80,
    inheritStyle: body.inheritStyle ?? true,
    inheritSeed: body.inheritSeed ?? false,
  };
}

function providerForImageModel(model: string): string {
  if (model.startsWith('google/')) return 'nanobanana';
  if (model === 'stub' || model.startsWith('stub/')) return 'stub';
  return config.PROVIDER_IMAGE || 'openai';
}

function scenesForEpisode(
  episode: { id: string; title: string; content: string; scenesJson: Prisma.JsonValue },
  fallbackScenes: ReferenceLibrary['scenes'],
): EpisodeScene[] {
  const raw = Array.isArray(episode.scenesJson) ? episode.scenesJson : [];
  const parsed = raw
    .map((item, fallbackIndex): EpisodeScene | null => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      return {
        index: typeof obj.index === 'number' ? obj.index : fallbackIndex,
        title: typeof obj.title === 'string' && obj.title.trim() ? obj.title : `${episode.title} ${fallbackIndex + 1}`,
        content: typeof obj.content === 'string' ? obj.content : episode.content,
        characters: Array.isArray(obj.characters)
          ? obj.characters.filter((v): v is string => typeof v === 'string')
          : [],
        environment: typeof obj.environment === 'string' ? obj.environment : '',
      };
    })
    .filter((item): item is EpisodeScene => Boolean(item));
  if (parsed.length > 0) return parsed;
  if (fallbackScenes.length > 0) {
    return fallbackScenes.map((scene, index) => ({
      index,
      title: scene.name,
      content: fallbackSceneContent(episode.content, scene),
      characters: [],
      environment: scene.name,
      referenceSceneId: scene.id,
    }));
  }
  return [{
    index: 0,
    title: episode.title,
    content: episode.content,
    characters: [],
    environment: '',
  }];
}

function fallbackSceneContent(script: string, scene: ReferenceLibrary['scenes'][number]): string {
  const description = scene.description.trim();
  const excerpt = excerptForScene(script, scene.name);
  if (!description) return excerpt;
  if (!excerpt.trim()) return description;
  return `${description}\n\n${excerpt}`;
}

function excerptForScene(script: string, sceneName: string): string {
  const idx = sceneSearchTerms(sceneName)
    .map((term) => script.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? -1;
  if (idx < 0) return script.slice(0, 1800);
  return script.slice(idx, idx + 1800);
}

function sceneSearchTerms(sceneName: string): string[] {
  const trimmed = sceneName.trim();
  const terms = [trimmed];
  const withoutScenePrefix = trimmed
    .replace(/^(?:INT\.\/EXT|EXT\.\/INT|INT|EXT)\.\s*/i, '')
    .replace(/\s*[-－—]\s*(?:清晨|上午|中午|下午|傍晚|黄昏|夜晚|晚上|深夜|凌晨)\s*$/u, '')
    .trim();
  if (withoutScenePrefix && withoutScenePrefix !== trimmed) terms.push(withoutScenePrefix);
  return Array.from(new Set(terms.filter(Boolean)));
}

async function loadReferenceLibrary(projectId: string) {
  const [characters, scenes, items] = await Promise.all([
    prisma.character.findMany({
      where: { projectId },
      include: { styles: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.scene.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
    prisma.item.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
  ]);
  return { characters, scenes, items };
}

function prefillReferences(scene: EpisodeScene, library: ReferenceLibrary) {
  const haystack = [scene.title, scene.content, scene.environment, ...scene.characters].join('\n');
  const characterStyleIds = library.characters
    .filter((character) => textMentions(haystack, character.name) || scene.characters.some((name) => textMentions(character.name, name)))
    .map((character) => character.styles.find((style) => style.assetId)?.id ?? character.styles[0]?.id)
    .filter((id): id is string => Boolean(id));
  const sceneIds = library.scenes
    .filter((item) => textMentions(haystack, item.name) || textMentions(item.name, scene.environment))
    .map((item) => item.id);
  if (scene.referenceSceneId && !sceneIds.includes(scene.referenceSceneId)) {
    sceneIds.unshift(scene.referenceSceneId);
  }
  const itemIds = library.items
    .filter((item) => textMentions(haystack, item.name))
    .map((item) => item.id);
  return { characterStyleIds, sceneIds, itemIds };
}

function textMentions(text: string, term: string): boolean {
  const needle = term.trim();
  if (!needle) return false;
  return text.includes(needle) || needle.includes(text.trim());
}

async function ensureCompositionTaskForScene(
  project: { id: string; stylePrompt: string; ratio: string },
  episode: { id: string; number: number },
  scene: EpisodeScene,
  library: ReferenceLibrary,
): Promise<string> {
  const refs = prefillReferences(scene, library);
  const title = `第${episode.number}集 · ${scene.title || `场景 ${scene.index + 1}`}`;
  const where = {
    episodeId_sceneIndex: {
      episodeId: episode.id,
      sceneIndex: scene.index,
    },
  };
  const existing = await prisma.compositionTask.findUnique({
    where,
    select: {
      id: true,
      status: true,
      currentImageRunId: true,
      imageAssetId: true,
      imageTaskId: true,
    },
  });
  if (!existing) {
    const created = await prisma.compositionTask.create({
      data: {
        projectId: project.id,
        episodeId: episode.id,
        sceneIndex: scene.index,
        title,
        scriptExcerpt: scene.content,
        prompt: buildCompositionPrompt(project, scene, refs),
        characterStyleIds: refs.characterStyleIds as Prisma.InputJsonValue,
        sceneIds: refs.sceneIds as Prisma.InputJsonValue,
        itemIds: refs.itemIds as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return created.id;
  }

  const canRefreshDraft =
    existing.status === 'DRAFT' &&
    !existing.currentImageRunId &&
    !existing.imageAssetId &&
    !existing.imageTaskId;
  await prisma.compositionTask.update({
    where: { id: existing.id },
    data: {
      projectId: project.id,
      episodeId: episode.id,
      sceneIndex: scene.index,
      title,
      scriptExcerpt: scene.content,
      ...(canRefreshDraft
        ? {
            prompt: buildCompositionPrompt(project, scene, refs),
            characterStyleIds: refs.characterStyleIds as Prisma.InputJsonValue,
            sceneIds: refs.sceneIds as Prisma.InputJsonValue,
            itemIds: refs.itemIds as Prisma.InputJsonValue,
          }
        : {}),
    },
  });
  return existing.id;
}

function buildCompositionPrompt(
  project: { stylePrompt: string; ratio: string },
  scene: EpisodeScene,
  refs: { characterStyleIds: string[]; sceneIds: string[]; itemIds: string[] },
): string {
  return [
    `合成镜头：${scene.title}`,
    scene.environment ? `环境：${scene.environment}` : '',
    scene.characters.length ? `出场人物：${scene.characters.join('、')}` : '',
    `剧情内容：\n${scene.content}`,
    `参考数量：角色 ${refs.characterStyleIds.length}，场景素材 ${refs.sceneIds.length}，道具 ${refs.itemIds.length}`,
    `画面要求：生成一张可作为镜头首帧的合成镜头图，人物、道具与环境需要自然同框，构图清晰，光线统一，比例 ${project.ratio}。`,
    project.stylePrompt ? `风格要求：${project.stylePrompt}` : '',
  ].filter(Boolean).join('\n\n');
}

function buildShotSketchPrompt(
  project: { stylePrompt: string; ratio: string },
  scene: EpisodeScene,
  shot: { displayId: number; shotType: string; duration: number; prompt: string },
  hasCompositionImage: boolean,
): string {
  const prompt = [
    '请生成一张单张电影分镜/合成镜头图，用作后续视频生成的参考首帧。',
    '',
    '强制要求：',
    '- 只输出一张完整画面，不要九宫格、拼贴、分屏或 contact sheet。',
    '- 不要在图片中写字幕、编号、角度标签、水印、logo 或任何说明文字。',
    '- 画面必须是电影镜头感，而不是海报、设定图、UI 或纯素材展示。',
    '- 人物、道具和环境需要自然同框；构图、光线、色彩保持统一。',
    `- 输出比例按 ${project.ratio} 构图。`,
    hasCompositionImage
      ? '- 已提供的合成镜头图是空间、角色、服装、光线和画风锚点；请在保持一致的基础上，根据本 Shot 重新构图。'
      : '',
    '',
    `Shot：#${shot.displayId}`,
    `镜头类型：${shot.shotType === 'continuation' ? '续写镜头' : '全新镜头'}`,
    `预计时长：${shot.duration} 秒`,
    `Shot 提示词：\n${truncateText(shot.prompt, 1400)}`,
    '',
    `场景标题：${scene.title}`,
    scene.environment ? `环境：${scene.environment}` : '',
    scene.characters.length ? `出场人物：${scene.characters.join('、')}` : '',
    `剧本片段：\n${truncateText(scene.content, 1800)}`,
    project.stylePrompt ? `项目风格：\n${truncateText(project.stylePrompt, 900)}` : '',
  ].filter(Boolean).join('\n');
  return truncateText(prompt, 5000);
}

function buildGridPrompt(
  project: { stylePrompt: string; ratio: string },
  imageRun: {
    prompt: string;
    task: {
      title: string;
      scriptExcerpt: string;
    };
  },
  settings: {
    ratio: string;
    specification: string;
    variationMode: string;
    consistency: number;
    inheritStyle: boolean;
  },
): string {
  const anglePlan = settings.variationMode === 'fixed_angles'
    ? [
        '1 远景 establishing shot，交代完整环境和人物位置',
        '2 中景 medium shot，人物与道具关系清楚',
        '3 近景 close shot，强调人物动作',
        '4 侧面 side angle，展示人物与场景纵深',
        '5 正面 frontal angle，人物正面持有/接触道具',
        '6 背影 rear angle，从人物身后看向环境',
        '7 俯拍 high angle，展示空间关系',
        '8 仰拍 low angle，增强戏剧张力',
        '9 特写 detail close-up，强调手部、道具或表情',
      ]
    : [
        '9 个画面必须是同一场景连续分镜中的不同机位、景别或摄影角度',
        '至少包含远景、中景、近景、特写、侧面、背影、俯拍、仰拍等变化',
      ];

  return [
    '请基于参考图生成一张 3x3 分镜网格（storyboard contact sheet），单张图片内必须分成 9 个清晰等大的画面格。',
    '',
    '核心目标：9 格必须表现同一个剧情场景、同一人物/服装、同一道具、同一环境、同一光线和同一画风，但每一格要是不同机位或不同景别，不能复制同一张图。',
    '',
    '强制构图要求：',
    '- 只输出一张 3x3 网格图，不要输出单张大图。',
    '- 每个格子都是一个可用分镜候选图，人物、道具、环境需要保持连续一致。',
    '- 不要在图片中写数字、角度标签、字幕、水印、logo 或说明文字。',
    '- 可以用细分隔线区分 9 个格子，但不要使用大面积边框或装饰。',
    `- 网格整体比例按 ${settings.ratio} 输出；每个格子都应像影视分镜画面，而不是海报或拼贴素材。`,
    `- 一致性强度：${settings.consistency}/100。优先保证人物身份、服装、道具和环境统一。`,
    settings.inheritStyle ? '- 继承参考图的整体风格、色彩、光线和镜头质感。' : '',
    '',
    '角度规划：',
    ...anglePlan.map((item) => `- ${item}`),
    '',
    `剧情场景：${imageRun.task.title}`,
    `剧情摘要：\n${imageRun.task.scriptExcerpt}`,
    `原始合成镜头提示词：\n${imageRun.prompt}`,
    project.stylePrompt ? `项目风格：\n${project.stylePrompt}` : '',
  ].filter(Boolean).join('\n');
}

async function resolveReferenceAssetIds(
  projectId: string,
  refs: { characterStyleIds: string[]; sceneIds: string[]; itemIds: string[] },
): Promise<string[]> {
  const [styles, scenes, items] = await Promise.all([
    prisma.characterStyle.findMany({
      where: { id: { in: refs.characterStyleIds }, character: { projectId } },
      select: { assetId: true, character: { select: { avatarAssetId: true } } },
    }),
    prisma.scene.findMany({
      where: { id: { in: refs.sceneIds }, projectId },
      select: { assetId: true },
    }),
    prisma.item.findMany({
      where: { id: { in: refs.itemIds }, projectId },
      select: { assetId: true },
    }),
  ]);
  return Array.from(new Set([
    ...styles.map((row) => row.assetId ?? row.character?.avatarAssetId ?? null),
    ...scenes.map((row) => row.assetId),
    ...items.map((row) => row.assetId),
  ].filter((id): id is string => Boolean(id)))).slice(0, 8);
}

async function buildShotSketchReferenceAssetIds(
  projectId: string,
  compositionTask: { characterStyleIds: unknown; sceneIds: unknown; itemIds: unknown },
  shot: { characterStyleIds: unknown; sceneIds: unknown; itemIds: unknown },
  compositionImageAssetId: string | null,
): Promise<string[]> {
  const assetIds = await resolveReferenceAssetIds(projectId, {
    characterStyleIds: uniqueStrings([
      ...jsonStringArray(shot.characterStyleIds),
      ...jsonStringArray(compositionTask.characterStyleIds),
    ]),
    sceneIds: uniqueStrings([
      ...jsonStringArray(shot.sceneIds),
      ...jsonStringArray(compositionTask.sceneIds),
    ]),
    itemIds: uniqueStrings([
      ...jsonStringArray(shot.itemIds),
      ...jsonStringArray(compositionTask.itemIds),
    ]),
  });
  return uniqueStrings([
    ...(compositionImageAssetId ? [compositionImageAssetId] : []),
    ...assetIds,
  ]).slice(0, 8);
}

function currentCompositionImageAssetId(row: {
  imageAssetId: string | null;
  currentImageRun: {
    outputAssetId: string | null;
    taskJob: { assets: Array<{ role: string; assetId: string }> } | null;
  } | null;
}): string | null {
  return (
    row.currentImageRun?.outputAssetId ??
    row.currentImageRun?.taskJob?.assets.find((asset) => asset.role === 'output')?.assetId ??
    row.imageAssetId ??
    null
  );
}

function shouldCreateShotSketch(
  shot: {
    prompt: string;
    sketchAssetId: string | null;
    sketchTask: { status: string } | null;
  },
  force: boolean,
): boolean {
  if (!shot.prompt.trim()) return false;
  if (force) return true;
  if (shot.sketchAssetId) return false;
  return shot.sketchTask?.status !== TaskStatus.QUEUED && shot.sketchTask?.status !== TaskStatus.RUNNING;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

async function assertAllCharacterStylesOwned(projectId: string, ids: string[], userId: string) {
  if (ids.length === 0) return;
  const count = await prisma.characterStyle.count({
    where: { id: { in: ids }, character: { projectId, project: { ownerId: userId } } },
  });
  if (count !== new Set(ids).size) throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'invalid character style reference');
}

async function assertAllScenesOwned(projectId: string, ids: string[], userId: string) {
  if (ids.length === 0) return;
  const count = await prisma.scene.count({ where: { id: { in: ids }, projectId, project: { ownerId: userId } } });
  if (count !== new Set(ids).size) throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'invalid scene reference');
}

async function assertAllItemsOwned(projectId: string, ids: string[], userId: string) {
  if (ids.length === 0) return;
  const count = await prisma.item.count({ where: { id: { in: ids }, projectId, project: { ownerId: userId } } });
  if (count !== new Set(ids).size) throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'invalid item reference');
}

function jsonStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string') : [];
}

async function readAssetBuffer(bucket: string, key: string): Promise<Buffer> {
  const stream = await minioClient.getObject(bucket, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function splitGridCandidates(source: Buffer): Promise<Buffer[]> {
  const meta = await sharp(source).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 3 || height < 3) {
    throw AppError.internal('分镜网格图片尺寸异常，无法拆分候选图');
  }
  const buffers: Buffer[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const left = Math.round((width * col) / 3);
      const top = Math.round((height * row) / 3);
      const right = Math.round((width * (col + 1)) / 3);
      const bottom = Math.round((height * (row + 1)) / 3);
      buffers.push(
        await sharp(source)
          .extract({
            left,
            top,
            width: Math.max(1, right - left),
            height: Math.max(1, bottom - top),
          })
          .png()
          .toBuffer(),
      );
    }
  }
  return buffers;
}

async function uploadGeneratedAsset(
  userId: string,
  compositionTaskId: string,
  label: string,
  buf: Buffer,
): Promise<Prisma.AssetUncheckedCreateInput> {
  const assetId = createId();
  const key = `${userId}/composition/${compositionTaskId}/${assetId}-${label}.png`;
  await minioClient.putObject(Buckets.TASK_OUTPUTS, key, buf, buf.length, { 'Content-Type': 'image/png' });
  const meta = await sharp(buf).metadata();
  return {
    id: assetId,
    ownerId: userId,
    bucket: Buckets.TASK_OUTPUTS,
    key,
    contentType: 'image/png',
    sizeBytes: buf.length,
    width: meta.width ?? null,
    height: meta.height ?? null,
    durationMs: null,
  };
}
