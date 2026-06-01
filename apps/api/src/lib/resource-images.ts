import type { Prisma, PrismaClient } from '@prisma/client';
import { TaskStatus } from '@oneness/shared/enums';
import type { ResourceImageKind } from '@oneness/shared/schemas';
import { AppError, ErrorCodes } from '@oneness/shared/errors';

type Db = PrismaClient | Prisma.TransactionClient;

export type OwnedResourceTarget = {
  kind: ResourceImageKind;
  entityId: string;
  projectId: string;
  ownerId: string;
  currentAssetId: string | null;
};

export function resourceImageEntityFields(
  kind: ResourceImageKind,
  entityId: string,
): Pick<Prisma.ResourceImageUncheckedCreateInput, 'characterStyleId' | 'sceneId' | 'itemId'> {
  if (kind === 'character-style') return { characterStyleId: entityId };
  if (kind === 'scene') return { sceneId: entityId };
  return { itemId: entityId };
}

export function resourceImageEntityWhere(
  kind: ResourceImageKind,
  entityId: string,
): Pick<Prisma.ResourceImageWhereInput, 'characterStyleId' | 'sceneId' | 'itemId'> {
  if (kind === 'character-style') return { characterStyleId: entityId };
  if (kind === 'scene') return { sceneId: entityId };
  return { itemId: entityId };
}

export function entityIdFromResourceImage(row: {
  kind: string;
  characterStyleId: string | null;
  sceneId: string | null;
  itemId: string | null;
}): string | null {
  if (row.kind === 'character-style') return row.characterStyleId;
  if (row.kind === 'scene') return row.sceneId;
  if (row.kind === 'item') return row.itemId;
  return null;
}

function parseResourceImageKind(kind: string): ResourceImageKind | null {
  if (kind === 'character-style' || kind === 'scene' || kind === 'item') return kind;
  return null;
}

export async function isLatestResourceImageForEntity(
  db: Db,
  row: {
    id: string;
    kind: string;
    characterStyleId: string | null;
    sceneId: string | null;
    itemId: string | null;
  },
): Promise<boolean> {
  const kind = parseResourceImageKind(row.kind);
  const entityId = entityIdFromResourceImage(row);
  if (!kind || !entityId) return false;
  const latest = await db.resourceImage.findFirst({
    where: {
      kind,
      ...resourceImageEntityWhere(kind, entityId),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  return latest?.id === row.id;
}

export async function loadOwnedResourceTarget(
  db: Db,
  kind: ResourceImageKind,
  entityId: string,
  userId: string,
): Promise<OwnedResourceTarget> {
  if (kind === 'character-style') {
    const style = await db.characterStyle.findFirst({
      where: { id: entityId, character: { project: { ownerId: userId } } },
      select: {
        id: true,
        assetId: true,
        character: {
          select: {
            projectId: true,
            project: { select: { ownerId: true } },
          },
        },
      },
    });
    if (!style) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'resource not found');
    return {
      kind,
      entityId: style.id,
      projectId: style.character.projectId,
      ownerId: style.character.project.ownerId,
      currentAssetId: style.assetId,
    };
  }

  if (kind === 'scene') {
    const scene = await db.scene.findFirst({
      where: { id: entityId, project: { ownerId: userId } },
      select: {
        id: true,
        assetId: true,
        projectId: true,
        project: { select: { ownerId: true } },
      },
    });
    if (!scene) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'resource not found');
    return {
      kind,
      entityId: scene.id,
      projectId: scene.projectId,
      ownerId: scene.project.ownerId,
      currentAssetId: scene.assetId,
    };
  }

  const item = await db.item.findFirst({
    where: { id: entityId, project: { ownerId: userId } },
    select: {
      id: true,
      assetId: true,
      projectId: true,
      project: { select: { ownerId: true } },
    },
  });
  if (!item) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'resource not found');
  return {
    kind,
    entityId: item.id,
    projectId: item.projectId,
    ownerId: item.project.ownerId,
    currentAssetId: item.assetId,
  };
}

export async function assertAssetOwned(db: Db, assetId: string, userId: string) {
  const asset = await db.asset.findFirst({
    where: { id: assetId, ownerId: userId },
    select: { id: true },
  });
  if (!asset) throw AppError.notFound(ErrorCodes.ASSET_NOT_FOUND, 'asset not found');
}

export async function assertTaskOwned(db: Db, taskId: string, userId: string) {
  const task = await db.task.findFirst({
    where: { id: taskId, ownerId: userId },
    select: { id: true },
  });
  if (!task) throw AppError.notFound(ErrorCodes.TASK_NOT_FOUND, 'task not found');
}

export async function setCurrentResourceAsset(
  db: Db,
  kind: ResourceImageKind,
  entityId: string,
  assetId: string | null,
) {
  if (kind === 'character-style') {
    await db.characterStyle.update({ where: { id: entityId }, data: { assetId } });
  } else if (kind === 'scene') {
    await db.scene.update({ where: { id: entityId }, data: { assetId } });
  } else {
    await db.item.update({ where: { id: entityId }, data: { assetId } });
  }
}

export async function linkResourceImageTaskResult(
  db: Db,
  taskId: string,
  status: TaskStatus,
  outputAssetIds: string[] = [],
  error?: string | null,
) {
  const rows = await db.resourceImage.findMany({
    where: { taskId },
    select: {
      id: true,
      kind: true,
      characterStyleId: true,
      sceneId: true,
      itemId: true,
    },
  });
  if (rows.length === 0) return;

  const firstOutputAssetId = outputAssetIds[0] ?? null;

  for (const row of rows) {
    const entityId = entityIdFromResourceImage(row);
    const kind = row.kind as ResourceImageKind;
    await db.resourceImage.update({
      where: { id: row.id },
      data: {
        status,
        ...(firstOutputAssetId ? { assetId: firstOutputAssetId } : {}),
        ...(error !== undefined ? { error } : {}),
      },
    });
    if (status === TaskStatus.SUCCEEDED && firstOutputAssetId && entityId) {
      const shouldSetCurrent = await isLatestResourceImageForEntity(db, row);
      if (shouldSetCurrent) {
        await setCurrentResourceAsset(db, kind, entityId, firstOutputAssetId);
      }
    }
  }
}
