import { Hono } from 'hono';
import { zValidator } from '../middleware/validator';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { enqueueTaskJob, removeTaskJob } from '../lib/queues.js';
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
import { TaskStatus } from '@oneness/shared/enums';
import { config } from '../config.js';

export const taskRoutes = new Hono();

taskRoutes.use('/tasks', tryReadUser, requireUser);
taskRoutes.use('/tasks/*', tryReadUser, requireUser);

// POST /api/tasks — atomic reserve + create + enqueue
taskRoutes.post('/tasks', zValidator('json', CreateTaskSchema), async (c) => {
  const user = c.var.user!;
  const body = c.req.valid('json');
  const estimate = estimateCost(body.type);

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
    return tx.task.create({
      data: {
        ownerId: user.id,
        projectId: body.projectId ?? null,
        type: body.type,
        provider: body.provider,
        status: TaskStatus.QUEUED,
        input: body.input as Prisma.InputJsonValue,
        costCredits: estimate,
      },
      include: { assets: { include: { asset: true } } },
    });
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
      select: { id: true, ownerId: true, costCredits: true, status: true },
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
    });

    const fresh = await prisma.task.findUnique({
      where: { id },
      include: { assets: { include: { asset: true } } },
    });
    return c.json(await serializeTask(fresh!));
  },
);
