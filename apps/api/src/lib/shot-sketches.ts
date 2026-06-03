import type { Prisma, PrismaClient } from '@prisma/client';
import { TaskStatus } from '@oneness/shared/enums';

type Db = PrismaClient | Prisma.TransactionClient;

export async function reconcileShotSketchTasksForEpisode(
  db: Db,
  episodeId: string,
): Promise<void> {
  const rows = await db.shot.findMany({
    where: {
      episodeId,
      OR: [{ sketchTaskId: { not: null } }, { sketchRuns: { some: {} } }],
    },
    select: { id: true },
  });
  await Promise.all(rows.map((row) => reconcileShotSketchTask(db, row.id)));
}

export async function reconcileShotSketchTask(db: Db, shotId: string): Promise<void> {
  const shot = await db.shot.findUnique({
    where: { id: shotId },
    select: {
      id: true,
      sketchAssetId: true,
      sketchTaskId: true,
      episodeId: true,
      episode: { select: { projectId: true } },
      sketchTask: {
        include: {
          assets: {
            where: { role: 'output' },
            select: { assetId: true, asset: { select: { createdAt: true } } },
            orderBy: { asset: { createdAt: 'desc' } },
            take: 1,
          },
        },
      },
      sketchRuns: {
        include: {
          taskJob: {
            include: {
              assets: {
                where: { role: 'output' },
                select: { assetId: true, asset: { select: { createdAt: true } } },
                orderBy: { asset: { createdAt: 'desc' } },
                take: 1,
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
    },
  });
  if (!shot) return;

  if (shot.sketchTaskId && shot.sketchTask && shot.sketchRuns.length === 0) {
    await createLegacyShotSketchRun(db, shot);
  }

  const runs = await db.shotSketchRun.findMany({
    where: { shotId: shot.id },
    include: {
      taskJob: {
        include: {
          assets: {
            where: { role: 'output' },
            select: { assetId: true, asset: { select: { createdAt: true } } },
            orderBy: { asset: { createdAt: 'desc' } },
            take: 1,
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  for (const run of runs) {
    const task = run.taskJob;
    if (!task) continue;
    const outputAssetId = task.assets[0]?.assetId ?? run.outputAssetId ?? null;
    const data: Prisma.ShotSketchRunUpdateInput = {};
    if (task.status === TaskStatus.SUCCEEDED && outputAssetId) {
      data.status = TaskStatus.SUCCEEDED;
      data.error = null;
      data.outputAsset = { connect: { id: outputAssetId } };
    } else if (task.status === TaskStatus.FAILED || task.status === TaskStatus.CANCELLED) {
      data.status = task.status;
      data.error = task.error;
      if (outputAssetId) data.outputAsset = { connect: { id: outputAssetId } };
    } else if (
      task.status === TaskStatus.RUNNING ||
      task.status === TaskStatus.QUEUED ||
      task.status === TaskStatus.RETRYING
    ) {
      data.status = task.status;
      data.error = task.error;
    }
    if (Object.keys(data).length > 0) {
      await db.shotSketchRun.update({ where: { id: run.id }, data });
    }

    if (task.status === TaskStatus.SUCCEEDED && outputAssetId && shot.sketchTaskId === task.id) {
      await db.shot.updateMany({
        where: { id: shot.id, sketchTaskId: task.id },
        data: { sketchAssetId: outputAssetId },
      });
    }
  }
}

async function createLegacyShotSketchRun(
  db: Db,
  shot: {
    id: string;
    episodeId: string;
    sketchAssetId: string | null;
    sketchTaskId: string | null;
    episode: { projectId: string };
    sketchTask: {
      id: string;
      status: string;
      input: Prisma.JsonValue;
      error: string | null;
      createdAt: Date;
      updatedAt: Date;
      assets: Array<{ assetId: string }>;
    } | null;
  },
) {
  if (!shot.sketchTaskId || !shot.sketchTask) return;
  const input = normalizeTaskInput(shot.sketchTask.input);
  const outputAssetId = shot.sketchAssetId ?? shot.sketchTask.assets[0]?.assetId ?? null;
  await db.shotSketchRun.create({
    data: {
      id: `ssr_${shot.id}_${shot.sketchTaskId}`,
      projectId: shot.episode.projectId,
      episodeId: shot.episodeId,
      shotId: shot.id,
      source: 'generated',
      prompt: typeof input.prompt === 'string' ? input.prompt : '',
      model: typeof input.model === 'string' ? input.model : null,
      ratio: typeof input.ratio === 'string' ? input.ratio : null,
      referenceAssetIds: Array.isArray(input.referenceAssetIds)
        ? (input.referenceAssetIds as Prisma.InputJsonValue)
        : [],
      params: { legacy: true } as Prisma.InputJsonValue,
      status: shot.sketchTask.status,
      error: shot.sketchTask.error,
      taskJobId: shot.sketchTaskId,
      outputAssetId,
      createdAt: shot.sketchTask.createdAt,
      updatedAt: shot.sketchTask.updatedAt,
    },
  }).catch(() => {});
}

function normalizeTaskInput(input: Prisma.JsonValue): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}
