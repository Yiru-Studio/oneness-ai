import { Prisma, type PrismaClient } from '@prisma/client';
import { buildShotSketchPrompt } from './shot-prompts';

type Db = PrismaClient | Prisma.TransactionClient;

export type ShotSketchProjectForPreparation = {
  id: string;
  stylePrompt: string;
  ratio: string;
  imageModel?: string | null;
};

export type ShotSketchEpisodeForPreparation = {
  id: string;
  number: number;
  title?: string | null;
};

export type ShotSketchSceneForPreparation = {
  index: number;
  title: string;
  content: string;
  characters: string[];
  environment: string;
};

export type ShotSketchShotForPreparation = {
  id: string;
  displayId: number;
  shotType: string;
  duration: number;
  prompt: string;
  compositionTaskIds?: unknown;
  characterStyleIds: unknown;
  sceneIds: unknown;
  itemIds: unknown;
};

export type ShotSketchCompositionTaskForPreparation = {
  id: string;
  characterStyleIds: unknown;
  sceneIds: unknown;
  itemIds: unknown;
};

export function jsonStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string') : [];
}

export function mergeShotSketchReferenceIds(
  compositionTask: { characterStyleIds: unknown; sceneIds: unknown; itemIds: unknown },
  shot: { characterStyleIds: unknown; sceneIds: unknown; itemIds: unknown },
) {
  const shotStyleIds = jsonStringArray(shot.characterStyleIds);
  const shotSceneIds = jsonStringArray(shot.sceneIds);
  const shotItemIds = jsonStringArray(shot.itemIds);
  return {
    characterStyleIds: uniqueStrings(shotStyleIds),
    sceneIds: shotSceneIds.length > 0
      ? uniqueStrings(shotSceneIds)
      : uniqueStrings(jsonStringArray(compositionTask.sceneIds)),
    itemIds: uniqueStrings(shotItemIds),
  };
}

export function currentCompositionImageAssetId(row: {
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

export async function resolveShotSketchReferenceAssetIds(
  db: Db,
  projectId: string,
  compositionTask: { characterStyleIds: unknown; sceneIds: unknown; itemIds: unknown },
  shot: { compositionTaskIds?: unknown; characterStyleIds: unknown; sceneIds: unknown; itemIds: unknown },
  compositionImageAssetId: string | null,
): Promise<string[]> {
  const refs = mergeShotSketchReferenceIds(compositionTask, shot);
  const assetIds = await resolveReferenceAssetIds(db, projectId, {
    compositionTaskIds: jsonStringArray(shot.compositionTaskIds),
    ...refs,
  });
  return uniqueStrings([
    ...(compositionImageAssetId ? [compositionImageAssetId] : []),
    ...assetIds,
  ]).slice(0, 8);
}

export async function prepareShotSketchRun(
  db: Db,
  args: {
    project: ShotSketchProjectForPreparation;
    episode: ShotSketchEpisodeForPreparation;
    scene: ShotSketchSceneForPreparation;
    shot: ShotSketchShotForPreparation;
    compositionTask: ShotSketchCompositionTaskForPreparation;
    compositionImageAssetId: string | null;
  },
) {
  const prompt = buildShotSketchPrompt(
    args.project,
    args.scene,
    args.shot,
    Boolean(args.compositionImageAssetId),
  );
  const referenceAssetIds = await resolveShotSketchReferenceAssetIds(
    db,
    args.project.id,
    args.compositionTask,
    args.shot,
    args.compositionImageAssetId,
  );
  await db.shotSketchRun.deleteMany({
    where: { shotId: args.shot.id, source: 'prepared' },
  });
  return db.shotSketchRun.create({
    data: {
      projectId: args.project.id,
      episodeId: args.episode.id,
      shotId: args.shot.id,
      source: 'prepared',
      prompt,
      model: args.project.imageModel ?? null,
      ratio: args.project.ratio,
      referenceAssetIds: referenceAssetIds as Prisma.InputJsonValue,
      params: {
        compositionTaskId: args.compositionTask.id,
        preparedBy: 'shot_breakdown',
      } as Prisma.InputJsonValue,
      status: 'APPLIED',
    },
  });
}

async function resolveReferenceAssetIds(
  db: Db,
  projectId: string,
  refs: { compositionTaskIds?: string[]; characterStyleIds: string[]; sceneIds: string[]; itemIds: string[] },
): Promise<string[]> {
  const [compositionTasks, styles, scenes, items] = await Promise.all([
    refs.compositionTaskIds?.length
      ? db.compositionTask.findMany({
          where: { id: { in: refs.compositionTaskIds }, projectId },
          include: {
            currentImageRun: {
              include: { taskJob: { include: { assets: true } } },
            },
          },
        })
      : Promise.resolve([]),
    db.characterStyle.findMany({
      where: { id: { in: refs.characterStyleIds }, character: { projectId } },
      select: {
        assetId: true,
        character: { select: { identityAssetId: true, avatarAssetId: true } },
      },
    }),
    db.scene.findMany({
      where: { id: { in: refs.sceneIds }, projectId },
      select: { assetId: true },
    }),
    db.item.findMany({
      where: { id: { in: refs.itemIds }, projectId },
      select: { assetId: true },
    }),
  ]);
  return uniqueAssetIds([
    ...compositionTasks.map(currentCompositionImageAssetId),
    ...styles.map(characterStyleReferenceAssetId),
    ...scenes.map((row) => row.assetId),
    ...items.map((row) => row.assetId),
  ]).slice(0, 8);
}

function characterStyleReferenceAssetId(row: {
  assetId: string | null;
  character: { identityAssetId: string | null; avatarAssetId: string | null } | null;
}): string | null {
  return row.assetId ?? row.character?.identityAssetId ?? row.character?.avatarAssetId ?? null;
}

function uniqueAssetIds(values: Array<string | null | undefined>): string[] {
  return uniqueStrings(values);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
