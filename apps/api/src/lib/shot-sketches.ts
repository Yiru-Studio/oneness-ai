import type { Prisma, PrismaClient } from '@prisma/client';
import { TaskStatus } from '@oneness/shared/enums';

type Db = PrismaClient | Prisma.TransactionClient;

export async function reconcileShotSketchTasksForEpisode(
  db: Db,
  episodeId: string,
): Promise<void> {
  const rows = await db.shot.findMany({
    where: { episodeId, sketchTaskId: { not: null } },
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
    },
  });
  if (!shot?.sketchTaskId || !shot.sketchTask) return;

  const outputAssetId = shot.sketchTask.assets[0]?.assetId ?? null;
  if (!outputAssetId) return;

  const terminalWithOutput =
    shot.sketchTask.status === TaskStatus.SUCCEEDED ||
    shot.sketchTask.status === TaskStatus.FAILED ||
    shot.sketchTask.status === TaskStatus.CANCELLED;
  if (!terminalWithOutput) return;
  if (shot.sketchAssetId === outputAssetId) return;

  await db.shot.updateMany({
    where: {
      id: shot.id,
      sketchTaskId: shot.sketchTaskId,
      OR: [{ sketchAssetId: null }, { sketchTask: { status: TaskStatus.SUCCEEDED } }],
    },
    data: { sketchAssetId: outputAssetId },
  });
}
