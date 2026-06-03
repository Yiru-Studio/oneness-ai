import { Hono } from 'hono';
import { zValidator } from '../middleware/validator.js';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { presignGet } from '../lib/assets.js';
import { enqueueTaskJob, hasTaskJob, QueueJobPriority } from '../lib/queues.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import { ImageGenerationRunsQuerySchema } from '@oneness/shared/schemas';
import { queueForTaskType } from '@oneness/shared/queues';
import { TaskStatus, TaskType } from '@oneness/shared/enums';

export const imageGenerationRunRoutes = new Hono();

imageGenerationRunRoutes.use('/image-generation-runs', tryReadUser, requireUser);
imageGenerationRunRoutes.use('/image-generation-runs/*', tryReadUser, requireUser);

const ACTIVE_STATUSES = new Set(['QUEUED', 'RUNNING', 'RETRYING', 'IMAGE_QUEUED', 'IMAGE_RUNNING', 'GRID_QUEUED', 'GRID_RUNNING']);

export type ImageGenerationRunDTO = {
  id: string;
  kind: 'resource' | 'composition-image' | 'composition-grid' | 'shot-sketch';
  projectId: string;
  ownerEntityId: string | null;
  ownerEntityKind: string | null;
  taskId: string | null;
  status: string;
  error: string | null;
  assetId: string | null;
  image: string;
  label: string;
  createdAt: string;
  updatedAt: string;
};

imageGenerationRunRoutes.get(
  '/image-generation-runs',
  zValidator('query', ImageGenerationRunsQuerySchema),
  async (c) => {
    const user = c.var.user!;
    const query = c.req.valid('query');
    await assertOwnedProject(query.projectId, user.id);
    const runs = await listImageGenerationRuns(query.projectId, {
      status: query.status,
      activeOnly: query.activeOnly,
      limit: query.limit,
    });
    return c.json(runs);
  },
);

imageGenerationRunRoutes.get(
  '/image-generation-runs/events',
  zValidator('query', ImageGenerationRunsQuerySchema),
  async (c) => {
    const user = c.var.user!;
    const query = c.req.valid('query');
    await assertOwnedProject(query.projectId, user.id);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = async () => {
          if (closed) return;
          const runs = await listImageGenerationRuns(query.projectId, {
            status: query.status,
            activeOnly: query.activeOnly,
            limit: query.limit,
          });
          controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(runs)}\n\n`));
        };
        await send();
        const timer = setInterval(() => {
          void send().catch((error) => {
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : 'stream error' })}\n\n`));
          });
        }, 2000);
        c.req.raw.signal.addEventListener('abort', () => {
          closed = true;
          clearInterval(timer);
          controller.close();
        });
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  },
);

imageGenerationRunRoutes.post(
  '/image-generation-runs/reconcile',
  zValidator('query', ImageGenerationRunsQuerySchema.pick({ projectId: true })),
  async (c) => {
    const user = c.var.user!;
    const { projectId } = c.req.valid('query');
    await assertOwnedProject(projectId, user.id);
    const result = await reconcileImageGenerationQueue(projectId);
    return c.json(result);
  },
);

async function assertOwnedProject(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: userId },
    select: { id: true },
  });
  if (!project) throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
}

async function listImageGenerationRuns(
  projectId: string,
  options: { status?: string; activeOnly?: boolean; limit: number },
): Promise<ImageGenerationRunDTO[]> {
  const [resources, imageRuns, gridRuns, sketchRuns] = await Promise.all([
    prisma.resourceImage.findMany({
      where: {
        projectId,
      },
      orderBy: { updatedAt: 'desc' },
      take: options.limit,
    }),
    prisma.compositionImageRun.findMany({
      where: {
        task: { projectId },
        ...(options.status ? { status: options.status } : {}),
      },
      include: { outputAsset: true, task: { select: { title: true, sceneIndex: true } } },
      orderBy: { updatedAt: 'desc' },
      take: options.limit,
    }),
    prisma.compositionGridRun.findMany({
      where: {
        task: { projectId },
        ...(options.status ? { status: options.status } : {}),
      },
      include: { gridAsset: true, task: { select: { title: true, sceneIndex: true } } },
      orderBy: { updatedAt: 'desc' },
      take: options.limit,
    }),
    prisma.shotSketchRun.findMany({
      where: {
        projectId,
        ...(options.status ? { status: options.status } : {}),
      },
      include: { outputAsset: true, shot: { select: { displayId: true } } },
      orderBy: { updatedAt: 'desc' },
      take: options.limit,
    }),
  ]);
  const resourceAssets = await prisma.asset.findMany({
    where: { id: { in: resources.map((row) => row.assetId).filter((id): id is string => Boolean(id)) } },
  });
  const resourceAssetById = new Map(resourceAssets.map((asset) => [asset.id, asset]));

  const rows: ImageGenerationRunDTO[] = [
    ...(await Promise.all(resources.map(async (row) => ({
      id: row.id,
      kind: 'resource' as const,
      projectId: row.projectId,
      ownerEntityId: row.characterStyleId ?? row.characterId ?? row.sceneId ?? row.itemId ?? null,
      ownerEntityKind: row.kind,
      taskId: row.taskId,
      status: row.status,
      error: row.error,
      assetId: row.assetId,
      image: row.assetId && resourceAssetById.has(row.assetId)
        ? await presignGet(resourceAssetById.get(row.assetId)!.bucket, resourceAssetById.get(row.assetId)!.key)
        : '',
      label: row.kind,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })))),
    ...(await Promise.all(imageRuns.map(async (row) => ({
      id: row.id,
      kind: 'composition-image' as const,
      projectId,
      ownerEntityId: row.taskId,
      ownerEntityKind: 'composition-task',
      taskId: row.taskJobId,
      status: row.status,
      error: row.error,
      assetId: row.outputAssetId,
      image: row.outputAsset ? await presignGet(row.outputAsset.bucket, row.outputAsset.key) : '',
      label: `第${row.task.sceneIndex + 1}场 · ${row.task.title}`,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })))),
    ...(await Promise.all(gridRuns.map(async (row) => ({
      id: row.id,
      kind: 'composition-grid' as const,
      projectId,
      ownerEntityId: row.taskId,
      ownerEntityKind: 'composition-task',
      taskId: row.taskJobId,
      status: row.status,
      error: row.error,
      assetId: row.gridAssetId,
      image: row.gridAsset ? await presignGet(row.gridAsset.bucket, row.gridAsset.key) : '',
      label: `第${row.task.sceneIndex + 1}场 · ${row.task.title} 分镜候选`,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })))),
    ...(await Promise.all(sketchRuns.map(async (row) => ({
      id: row.id,
      kind: 'shot-sketch' as const,
      projectId: row.projectId,
      ownerEntityId: row.shotId,
      ownerEntityKind: 'shot',
      taskId: row.taskJobId,
      status: row.status,
      error: row.error,
      assetId: row.outputAssetId,
      image: row.outputAsset ? await presignGet(row.outputAsset.bucket, row.outputAsset.key) : '',
      label: `Shot ${row.shot.displayId} 主分镜`,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })))),
  ];

  return rows
    .filter((row) => !options.status || row.status === options.status)
    .filter((row) => !options.activeOnly || ACTIVE_STATUSES.has(row.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, options.limit);
}

async function reconcileImageGenerationQueue(projectId: string) {
  const tasks = await prisma.task.findMany({
    where: {
      projectId,
      type: TaskType.IMAGE,
      status: { in: [TaskStatus.QUEUED, TaskStatus.RETRYING] },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  let reenqueued = 0;
  const queueName = queueForTaskType(TaskType.IMAGE);
  for (const task of tasks) {
    if (await hasTaskJob(queueName, task.id)) continue;
    await enqueueTaskJob(queueName, task.id, { priority: QueueJobPriority.INTERACTIVE_IMAGE });
    reenqueued += 1;
  }
  return { scanned: tasks.length, reenqueued };
}
