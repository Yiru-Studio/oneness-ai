import { Hono } from 'hono';
import { Prisma } from '@prisma/client';
import { zValidator } from '../middleware/validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { enqueueTaskJob } from '../lib/queues.js';
import { serializeTask } from '../serializers/task.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import { estimateCost } from '@oneness/shared/pricing';
import { queueForTaskType } from '@oneness/shared/queues';
import {
  GenerateResourcePromptSchema,
  type ResourceImageKind,
} from '@oneness/shared/schemas';
import {
  ResourcePromptStatus,
  ResourceReviewStatus,
  TaskStatus,
  TaskType,
} from '@oneness/shared/enums';
import { config } from '../config.js';

export const resourcePromptRoutes = new Hono();

resourcePromptRoutes.use('/resource-prompts/generate', tryReadUser, requireUser);

type PromptTarget = {
  kind: ResourceImageKind;
  entityId: string;
  projectId: string;
  analysisModel: string;
  reviewStatus: string;
  promptStatus: string;
};

resourcePromptRoutes.post(
  '/resource-prompts/generate',
  zValidator('json', GenerateResourcePromptSchema),
  async (c) => {
    const user = c.var.user!;
    const body = c.req.valid('json');
    const target = await loadPromptTarget(body.kind, body.entityId, user.id);

    if (target.reviewStatus !== ResourceReviewStatus.CONFIRMED) {
      throw AppError.badRequest(
        ErrorCodes.VALIDATION_FAILED,
        '请先确认素材名称和描述，再生成图片提示词',
      );
    }
    if (
      target.promptStatus === ResourcePromptStatus.QUEUED ||
      target.promptStatus === ResourcePromptStatus.RUNNING
    ) {
      throw AppError.conflict(ErrorCodes.CONFLICT, '提示词任务已在进行中');
    }

    const cost = estimateCost(TaskType.TEXT_ANALYZE);
    const providerName = config.PROVIDER_TEXT;
    const input = {
      analysisType: 'resource_prompt',
      kind: target.kind,
      entityId: target.entityId,
      model: body.model || target.analysisModel,
    } satisfies Prisma.InputJsonObject;

    const task = await prisma.$transaction(async (tx) => {
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
      const created = await tx.task.create({
        data: {
          ownerId: user.id,
          projectId: target.projectId,
          type: TaskType.TEXT_ANALYZE,
          provider: providerName,
          status: TaskStatus.QUEUED,
          input,
          costCredits: cost,
        },
        include: { assets: { include: { asset: true } } },
      });
      await setPromptStatus(tx, target.kind, target.entityId, {
        promptStatus: ResourcePromptStatus.QUEUED,
        promptTaskId: created.id,
        promptError: null,
      });
      return created;
    });

    await enqueueTaskJob(queueForTaskType(TaskType.TEXT_ANALYZE), task.id);
    return c.json(await serializeTask(task), 201);
  },
);

async function loadPromptTarget(
  kind: ResourceImageKind,
  entityId: string,
  userId: string,
): Promise<PromptTarget> {
  if (kind === 'character-style') {
    const style = await prisma.characterStyle.findFirst({
      where: { id: entityId, character: { project: { ownerId: userId } } },
      select: {
        id: true,
        promptStatus: true,
        character: {
          select: {
            reviewStatus: true,
            projectId: true,
            project: { select: { analysisModel: true } },
          },
        },
      },
    });
    if (!style) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'resource not found');
    return {
      kind,
      entityId: style.id,
      projectId: style.character.projectId,
      analysisModel: style.character.project.analysisModel,
      reviewStatus: style.character.reviewStatus,
      promptStatus: style.promptStatus,
    };
  }

  if (kind === 'scene') {
    const scene = await prisma.scene.findFirst({
      where: { id: entityId, project: { ownerId: userId } },
      select: {
        id: true,
        projectId: true,
        reviewStatus: true,
        promptStatus: true,
        project: { select: { analysisModel: true } },
      },
    });
    if (!scene) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'resource not found');
    return {
      kind,
      entityId: scene.id,
      projectId: scene.projectId,
      analysisModel: scene.project.analysisModel,
      reviewStatus: scene.reviewStatus,
      promptStatus: scene.promptStatus,
    };
  }

  const item = await prisma.item.findFirst({
    where: { id: entityId, project: { ownerId: userId } },
    select: {
      id: true,
      projectId: true,
      reviewStatus: true,
      promptStatus: true,
      project: { select: { analysisModel: true } },
    },
  });
  if (!item) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'resource not found');
  return {
    kind,
    entityId: item.id,
    projectId: item.projectId,
    analysisModel: item.project.analysisModel,
    reviewStatus: item.reviewStatus,
    promptStatus: item.promptStatus,
  };
}

async function setPromptStatus(
  tx: Prisma.TransactionClient,
  kind: ResourceImageKind,
  entityId: string,
  data: {
    promptStatus: ResourcePromptStatus;
    promptTaskId?: string | null;
    promptError?: string | null;
  },
) {
  if (kind === 'character-style') {
    await tx.characterStyle.update({ where: { id: entityId }, data });
  } else if (kind === 'scene') {
    await tx.scene.update({ where: { id: entityId }, data });
  } else {
    await tx.item.update({ where: { id: entityId }, data });
  }
}
