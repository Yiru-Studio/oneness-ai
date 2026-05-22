import { Hono } from 'hono';
import { zValidator } from '../middleware/validator';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { enqueueTaskJob, removeTaskJob } from '../lib/queues.js';
import {
  linkResourceImageTaskResult,
  loadOwnedResourceTarget,
  resourceImageEntityFields,
} from '../lib/resource-images.js';
import { serializeTask } from '../serializers/task.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import { estimateCost } from '@oneness/shared/pricing';
import { queueForTaskType } from '@oneness/shared/queues';
import {
  CreateTaskSchema,
  TaskListQuerySchema,
  InternalUpdateTaskSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';
import {
  ResourcePromptStatus,
  ResourceReviewStatus,
  TaskStatus,
} from '@oneness/shared/enums';
import { config } from '../config.js';

export const taskRoutes = new Hono();

taskRoutes.use('/tasks', tryReadUser, requireUser);
taskRoutes.use('/tasks/*', tryReadUser, requireUser);

// POST /api/tasks — atomic reserve + create + enqueue
taskRoutes.post('/tasks', zValidator('json', CreateTaskSchema), async (c) => {
  const user = c.var.user!;
  const body = c.req.valid('json');
  const estimate = estimateCost(body.type);
  if (
    body.type === 'TEXT_ANALYZE' &&
    'analysisType' in body.input &&
    body.input.analysisType === 'resource_prompt'
  ) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_FAILED,
      'resource prompt tasks must be created via /api/resource-prompts/generate',
    );
  }
  const resourceTarget =
    body.type === 'IMAGE' && body.resourceTarget
      ? await loadOwnedResourceTarget(
          prisma,
          body.resourceTarget.kind,
          body.resourceTarget.entityId,
          user.id,
        )
      : null;

  // Validate projectId belongs to user if provided
  if (body.projectId) {
    const p = await prisma.project.findFirst({
      where: { id: body.projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!p) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
  }
  if (resourceTarget && body.projectId && body.projectId !== resourceTarget.projectId) {
    throw AppError.badRequest(
      ErrorCodes.VALIDATION_FAILED,
      'resource target does not belong to project',
    );
  }
  if (resourceTarget) {
    if (resourceTarget.reviewStatus !== ResourceReviewStatus.CONFIRMED) {
      throw AppError.badRequest(
        ErrorCodes.VALIDATION_FAILED,
        '请先确认素材名称和描述，再生成图片',
      );
    }
    if (resourceTarget.promptStatus !== ResourcePromptStatus.READY) {
      throw AppError.badRequest(
        ErrorCodes.VALIDATION_FAILED,
        '请先生成并确认图片提示词，再生成图片',
      );
    }
  }

  // If a characterId is provided, auto-inject its avatar as a reference image.
  const input = { ...body.input } as Record<string, unknown>;
  if (
    body.type === 'IMAGE' &&
    input.characterId &&
    typeof input.characterId === 'string'
  ) {
    const character = await prisma.character.findFirst({
      where: { id: input.characterId, project: { ownerId: user.id } },
      select: { avatarAssetId: true },
    });
    if (character?.avatarAssetId) {
      const existingRefs = Array.isArray(input.referenceAssetIds)
        ? (input.referenceAssetIds as string[])
        : [];
      const refs = new Set([character.avatarAssetId, ...existingRefs]);
      input.referenceAssetIds = Array.from(refs);
    }
    // Don't persist characterId into the task input — it's a routing hint only.
    delete input.characterId;
  }

  const task = await prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({
      where: { id: user.id },
      select: { credits: true },
    });
    if (!u) throw AppError.unauthorized();
    if (u.credits < estimate) {
      throw AppError.badRequest(
        ErrorCodes.INSUFFICIENT_CREDITS,
        `requires ${estimate} credits, have ${u.credits}`,
        { required: estimate, available: u.credits },
      );
    }
    await tx.user.update({
      where: { id: user.id },
      data: { credits: { decrement: estimate } },
    });
    const task = await tx.task.create({
      data: {
        ownerId: user.id,
        projectId: resourceTarget?.projectId ?? body.projectId ?? null,
        type: body.type,
        provider: body.provider,
        status: TaskStatus.QUEUED,
        input: input as Prisma.InputJsonValue,
        costCredits: estimate,
      },
      include: { assets: { include: { asset: true } } },
    });
    if (resourceTarget && body.type === 'IMAGE') {
      await tx.resourceImage.create({
        data: {
          ownerId: user.id,
          projectId: resourceTarget.projectId,
          kind: body.resourceTarget!.kind,
          source: 'generated',
          status: TaskStatus.QUEUED,
          prompt: typeof input.prompt === 'string' ? input.prompt : '',
          model: typeof input.model === 'string' ? input.model : null,
          ratio: typeof input.ratio === 'string' ? input.ratio : null,
          taskId: task.id,
          ...resourceImageEntityFields(
            body.resourceTarget!.kind,
            body.resourceTarget!.entityId,
          ),
        },
      });
    }
    return task;
  });

  // Enqueue AFTER transaction commits so worker can't observe a half-created Task.
  await enqueueTaskJob(queueForTaskType(body.type), task.id);

  return c.json(await serializeTask(task), 201);
});

// GET /api/tasks/:id
taskRoutes.get(
  '/tasks/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const task = await prisma.task.findFirst({
      where: { id, ownerId: user.id },
      include: { assets: { include: { asset: true } } },
    });
    if (!task) {
      throw AppError.notFound(ErrorCodes.TASK_NOT_FOUND, 'task not found');
    }
    return c.json(await serializeTask(task));
  },
);

// GET /api/tasks — cursor pagination
taskRoutes.get(
  '/tasks',
  zValidator('query', TaskListQuerySchema),
  async (c) => {
    const user = c.var.user!;
    const q = c.req.valid('query');
    const where = {
      ownerId: user.id,
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const items = await prisma.task.findMany({
      where,
      take: q.limit + 1, // fetch one extra to know if there's a next page
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: { assets: { include: { asset: true } } },
    });
    const hasMore = items.length > q.limit;
    const slice = items.slice(0, q.limit);
    const serialized = await Promise.all(slice.map(serializeTask));
    return c.json({
      items: serialized,
      nextCursor: hasMore ? slice[slice.length - 1]?.id ?? null : null,
    });
  },
);

// POST /api/tasks/:id/cancel
taskRoutes.post(
  '/tasks/:id/cancel',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');

    const loadTask = () =>
      prisma.task.findFirst({
        where: { id, ownerId: user.id },
        select: {
          id: true,
          ownerId: true,
          type: true,
          status: true,
          costCredits: true,
          input: true,
        },
      });

    let task = await loadTask();
    if (!task) {
      throw AppError.notFound(ErrorCodes.TASK_NOT_FOUND, 'task not found');
    }
    if (
      task.status === TaskStatus.SUCCEEDED ||
      task.status === TaskStatus.FAILED ||
      task.status === TaskStatus.CANCELLED
    ) {
      throw AppError.conflict(
        ErrorCodes.TASK_NOT_CANCELLABLE,
        `task is in terminal status ${task.status}`,
      );
    }

    if (task.status === TaskStatus.QUEUED) {
      // Race-safe: only refund + cancel if the row is STILL QUEUED at write time.
      // If the worker has already claimed it (-> RUNNING) between our read and
      // this transaction, updateMany.count will be 0 and we fall through to the
      // RUNNING branch (no double refund — worker will refund on its next poll).
      const [, updated] = await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { credits: { increment: task.costCredits } },
        }),
        prisma.task.updateMany({
          where: { id, status: TaskStatus.QUEUED },
          data: {
            status: TaskStatus.CANCELLED,
            completedAt: new Date(),
          },
        }),
      ]);
      if (updated.count === 0) {
        // Worker beat us. Re-read and either fall through to RUNNING-cancel,
        // or 409 if it has already reached a terminal state.
        // First, revert the speculative refund we just applied.
        await prisma.user.update({
          where: { id: user.id },
          data: { credits: { decrement: task.costCredits } },
        });
        task = await loadTask();
        if (!task) {
          throw AppError.notFound(ErrorCodes.TASK_NOT_FOUND, 'task not found');
        }
        if (
          task.status === TaskStatus.SUCCEEDED ||
          task.status === TaskStatus.FAILED ||
          task.status === TaskStatus.CANCELLED
        ) {
          throw AppError.conflict(
            ErrorCodes.TASK_NOT_CANCELLABLE,
            `task is in terminal status ${task.status}`,
          );
        }
        // task.status is now RUNNING — fall into RUNNING-cancel handling.
        await prisma.task.update({
          where: { id },
          data: { status: TaskStatus.CANCELLED },
        });
      } else {
        // Successfully cancelled while still QUEUED — pull from BullMQ. Best-effort.
        await removeTaskJob(queueForTaskType(task.type), id);
      }
    } else {
      // RUNNING — set CANCELLED, worker will see it on its next poll and refund.
      await prisma.task.update({
        where: { id },
        data: { status: TaskStatus.CANCELLED },
      });
    }
    await linkResourceImageTaskResult(prisma, id, TaskStatus.CANCELLED);
    await linkResourcePromptTaskStatus(
      id,
      task.input,
      ResourcePromptStatus.FAILED,
      '任务已取消',
    );

    const fresh = await prisma.task.findUnique({
      where: { id },
      include: { assets: { include: { asset: true } } },
    });
    return c.json(await serializeTask(fresh!));
  },
);

// PATCH /api/internal/tasks/:id — external workflow callback.
// NOT user-scoped — auth is the X-Internal-Secret shared header only.
// (The file-level taskRoutes.use('/tasks', ...) and '/tasks/*' middlewares only
// match those prefixes, so this route does NOT inherit tryReadUser/requireUser.)
taskRoutes.patch(
  '/internal/tasks/:id',
  zValidator('param', IdParamSchema),
  async (c, next) => {
    const sec = c.req.header('x-internal-secret');
    if (!sec || sec !== config.INTERNAL_SECRET) {
      throw AppError.forbidden('invalid internal secret');
    }
    await next();
  },
  zValidator('json', InternalUpdateTaskSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const task = await prisma.task.findUnique({
      where: { id },
      select: { id: true, ownerId: true, costCredits: true, status: true, input: true },
    });
    if (!task) throw AppError.notFound(ErrorCodes.TASK_NOT_FOUND, 'task not found');

    const data: Record<string, unknown> = {};
    if (body.status) {
      data.status = body.status;
      if (
        body.status === TaskStatus.SUCCEEDED ||
        body.status === TaskStatus.FAILED ||
        body.status === TaskStatus.CANCELLED
      ) {
        data.completedAt = new Date();
      }
    }
    if (body.output !== undefined) data.output = body.output;
    if (body.error !== undefined) data.error = body.error;
    if (body.actualCostCredits !== undefined) data.costCredits = body.actualCostCredits;

    // Refund if transitioning to FAILED or CANCELLED for the first time.
    const isTerminalRefund =
      (body.status === TaskStatus.FAILED || body.status === TaskStatus.CANCELLED) &&
      task.status !== TaskStatus.FAILED &&
      task.status !== TaskStatus.CANCELLED;

    await prisma.$transaction(async (tx) => {
      if (isTerminalRefund) {
        await tx.user.update({
          where: { id: task.ownerId },
          data: { credits: { increment: task.costCredits } },
        });
      }
      await tx.task.update({ where: { id }, data });
      if (body.outputAssetIds) {
        for (const aid of body.outputAssetIds) {
          await tx.taskAsset.upsert({
            where: { taskId_assetId_role: { taskId: id, assetId: aid, role: 'output' } },
            create: { taskId: id, assetId: aid, role: 'output' },
            update: {},
          });
        }
      }
      if (body.status) {
        await linkResourceImageTaskResult(
          tx,
          id,
          body.status,
          body.outputAssetIds ?? [],
          body.error,
        );
      }
    });
    if (body.status === TaskStatus.FAILED || body.status === TaskStatus.CANCELLED) {
      await linkResourcePromptTaskStatus(
        id,
        task.input,
        ResourcePromptStatus.FAILED,
        body.error ?? (body.status === TaskStatus.CANCELLED ? '任务已取消' : '提示词生成失败'),
      );
    }

    const fresh = await prisma.task.findUnique({
      where: { id },
      include: { assets: { include: { asset: true } } },
    });
    return c.json(await serializeTask(fresh!));
  },
);

type ResourcePromptTaskInput = {
  analysisType: 'resource_prompt';
  kind: 'character-style' | 'scene' | 'item';
  entityId: string;
};

function readResourcePromptInput(input: unknown): ResourcePromptTaskInput | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  if (obj.analysisType !== 'resource_prompt') return null;
  if (
    obj.kind !== 'character-style' &&
    obj.kind !== 'scene' &&
    obj.kind !== 'item'
  ) {
    return null;
  }
  if (typeof obj.entityId !== 'string' || obj.entityId.length === 0) return null;
  return {
    analysisType: 'resource_prompt',
    kind: obj.kind,
    entityId: obj.entityId,
  };
}

async function linkResourcePromptTaskStatus(
  taskId: string,
  input: unknown,
  promptStatus: ResourcePromptStatus,
  promptError: string | null,
) {
  const parsed = readResourcePromptInput(input);
  if (!parsed) return;
  const data = { promptStatus, promptTaskId: taskId, promptError };
  if (parsed.kind === 'character-style') {
    await prisma.characterStyle.update({ where: { id: parsed.entityId }, data });
  } else if (parsed.kind === 'scene') {
    await prisma.scene.update({ where: { id: parsed.entityId }, data });
  } else {
    await prisma.item.update({ where: { id: parsed.entityId }, data });
  }
}
