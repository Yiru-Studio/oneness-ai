import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { enqueueTaskJob } from '../lib/queues.js';
import { serializeTask } from '../serializers/task.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import { estimateCost } from '@oneness/shared/pricing';
import { queueForTaskType } from '@oneness/shared/queues';
import {
  CreateTaskSchema,
  TaskListQuerySchema,
  IdParamSchema,
} from '@oneness/shared/schemas';
import { TaskStatus } from '@oneness/shared/enums';

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
