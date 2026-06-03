import { Hono } from 'hono';
import { zValidator } from '../middleware/validator';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import {
  enqueueTaskJob,
  enqueueTaskRetry,
  hasTaskJob,
  QueueJobPriority,
  removeTaskJob,
} from '../lib/queues.js';
import {
  linkResourceImageTaskResult,
  loadOwnedResourceTarget,
  resourceImageEntityFields,
  resourceImageEntityWhere,
} from '../lib/resource-images.js';
import {
  prependIdentityReference,
  resolveCharacterIdentityReference,
  resolveStyleIdentitySeed,
  resolveStyleIdentityReference,
} from '../lib/character-identity.js';
import { serializeTask } from '../serializers/task.js';
import { stripCharacterStyleMetadataForGeneration } from '@oneness/shared/character-analysis';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import { estimateCost } from '@oneness/shared/pricing';
import { queueForTaskType } from '@oneness/shared/queues';
import {
  CreateTaskSchema,
  TaskListQuerySchema,
  InternalUpdateTaskSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';
import { buildResourceImagePrompt } from '@oneness/shared/resource-prompts';
import { TaskStatus, TaskType } from '@oneness/shared/enums';
import { config } from '../config.js';

export const taskRoutes = new Hono();

taskRoutes.use('/tasks', tryReadUser, requireUser);
taskRoutes.use('/tasks/*', tryReadUser, requireUser);

// POST /api/tasks — atomic reserve + create + enqueue
taskRoutes.post('/tasks', zValidator('json', CreateTaskSchema), async (c) => {
  const user = c.var.user!;
  const body = c.req.valid('json');
  const estimate = estimateCost(body.type);
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
  if (resourceTarget && body.type === TaskType.IMAGE) {
    const activeResourceTask = await findActiveResourceImageTask(
      resourceTarget.kind,
      resourceTarget.entityId,
      user.id,
    );
    if (activeResourceTask) {
      return c.json(await serializeTask(activeResourceTask), 202);
    }
  }

  // Character-style generation must stay identity-bound. The identity master
  // is always the first reference image; user-provided refs follow it.
  const input = { ...body.input } as Record<string, unknown>;
  const characterIdHint =
    body.type === 'IMAGE' && typeof input.characterId === 'string'
      ? input.characterId
      : null;
  if (body.type === 'IMAGE') {
    const styleIdentitySeed =
      body.resourceTarget?.kind === 'character-style'
        ? await resolveStyleIdentitySeed(prisma, body.resourceTarget.entityId, user.id)
        : null;
    const styleIdentity =
      body.resourceTarget?.kind === 'character-style'
        ? await resolveStyleIdentityReference(
            prisma,
            body.resourceTarget.entityId,
            user.id,
          )
        : null;
    const hintedIdentity =
      !styleIdentity && characterIdHint
        ? await resolveCharacterIdentityReference(prisma, characterIdHint, user.id)
        : null;
    const identity = styleIdentity ?? hintedIdentity;
    const canGenerateStyleIdentitySeed =
      body.resourceTarget?.kind === 'character-style' &&
      !styleIdentitySeed?.hasIdentity;
    if (body.resourceTarget?.kind === 'character-style' && !identity && !canGenerateStyleIdentitySeed) {
      throw AppError.badRequest(
        ErrorCodes.VALIDATION_FAILED,
        '请先生成或上传角色头像，作为造型生成的身份母版',
      );
    }
    if (identity) {
      input.identityReferenceAssetId = identity.assetId;
      input.referenceAssetIds = prependIdentityReference(
        input.referenceAssetIds,
        identity.assetId,
      );
    }
  }
  if (body.type === 'IMAGE' && typeof input.prompt === 'string') {
    input.prompt = await governImagePrompt({
      prompt: input.prompt,
      userId: user.id,
      resourceTarget: body.resourceTarget ?? null,
      characterIdHint,
      ratio: typeof input.ratio === 'string' ? input.ratio : null,
      projectId: resourceTarget?.projectId ?? body.projectId ?? null,
    });
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
  await enqueueCreatedTaskOrRollback(task.id, user.id, body.type, estimate, {
    ...(body.type === TaskType.IMAGE
      ? { priority: QueueJobPriority.INTERACTIVE_IMAGE }
      : {}),
  });

  return c.json(await serializeTask(task), 201);
});

async function findActiveResourceImageTask(
  kind: 'character-avatar' | 'character-style' | 'scene' | 'item',
  entityId: string,
  ownerId: string,
) {
  const row = await prisma.resourceImage.findFirst({
    where: {
      ownerId,
      kind,
      status: { in: [TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.RETRYING] },
      task: {
        type: TaskType.IMAGE,
        status: { in: [TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.RETRYING] },
      },
      ...resourceImageEntityWhere(kind, entityId),
    },
    include: {
      task: { include: { assets: { include: { asset: true } } } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return row?.task ?? null;
}

const THREE_VIEW_MARKER = '@三视图';

function splitThreeViewMarker(prompt: string): { marker: boolean; body: string } {
  const trimmed = prompt.trimStart();
  if (!trimmed.startsWith(THREE_VIEW_MARKER)) return { marker: false, body: prompt };
  return {
    marker: true,
    body: trimmed.slice(THREE_VIEW_MARKER.length).replace(/^\s*\n?/, '').trim(),
  };
}

async function governImagePrompt(args: {
  prompt: string;
  userId: string;
  resourceTarget: { kind: 'character-avatar' | 'character-style' | 'scene' | 'item'; entityId: string } | null;
  characterIdHint: string | null;
  ratio: string | null;
  projectId: string | null;
}): Promise<string> {
  const { marker, body } = splitThreeViewMarker(args.prompt);
  const governed = await buildGovernedImagePrompt({
    ...args,
    prompt: body,
  });
  if (!governed) return args.prompt;
  return marker ? `${THREE_VIEW_MARKER}\n${governed}` : governed;
}

async function projectStylePrompt(projectId: string | null): Promise<string> {
  if (!projectId) return '';
  const project = await prisma.project.findFirst({
    where: { id: projectId },
    select: { stylePrompt: true, style: true },
  });
  return project?.stylePrompt?.trim() || project?.style?.trim() || '';
}

async function buildGovernedImagePrompt(args: {
  prompt: string;
  userId: string;
  resourceTarget: { kind: 'character-avatar' | 'character-style' | 'scene' | 'item'; entityId: string } | null;
  characterIdHint: string | null;
  ratio: string | null;
  projectId: string | null;
}): Promise<string | null> {
  const stylePrompt = await projectStylePrompt(args.projectId);

  if (args.resourceTarget?.kind === 'item') {
    const item = await prisma.item.findFirst({
      where: { id: args.resourceTarget.entityId, project: { ownerId: args.userId } },
      select: { name: true, description: true },
    });
    if (!item) return null;
    return buildResourceImagePrompt({
      kind: 'item',
      name: item.name,
      description: item.description,
      userPrompt: args.prompt,
      projectStylePrompt: stylePrompt,
      ratio: args.ratio,
    });
  }

  if (args.resourceTarget?.kind === 'scene') {
    const scene = await prisma.scene.findFirst({
      where: { id: args.resourceTarget.entityId, project: { ownerId: args.userId } },
      select: { name: true, description: true },
    });
    if (!scene) return null;
    return buildResourceImagePrompt({
      kind: 'scene',
      name: scene.name,
      description: scene.description,
      userPrompt: args.prompt,
      projectStylePrompt: stylePrompt,
      ratio: args.ratio,
    });
  }

  if (args.resourceTarget?.kind === 'character-style') {
    const style = await prisma.characterStyle.findFirst({
      where: { id: args.resourceTarget.entityId, character: { project: { ownerId: args.userId } } },
      select: {
        name: true,
        prompt: true,
        character: {
          select: {
            name: true,
            description: true,
            bio: true,
          },
        },
      },
    });
    if (!style) return null;
    return buildResourceImagePrompt({
      kind: 'character-style',
      name: style.character.name,
      description: style.character.description,
      bio: style.character.bio,
      styleName: style.name,
      userPrompt: stripCharacterStyleMetadataForGeneration(args.prompt || style.prompt),
      projectStylePrompt: stylePrompt,
      ratio: args.ratio,
    });
  }

  const avatarCharacterId =
    args.resourceTarget?.kind === 'character-avatar'
      ? args.resourceTarget.entityId
      : args.characterIdHint;

  if (avatarCharacterId) {
    const character = await prisma.character.findFirst({
      where: { id: avatarCharacterId, project: { ownerId: args.userId } },
      select: { name: true, description: true, bio: true, avatarPrompt: true },
    });
    if (!character) return null;
    return buildResourceImagePrompt({
      kind: 'character-avatar',
      name: character.name,
      description: character.description,
      bio: character.bio,
      userPrompt: args.prompt || character.avatarPrompt,
      projectStylePrompt: stylePrompt,
      ratio: args.ratio,
    });
  }

  return null;
}

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
    if (isTerminalTaskStatus(task.status)) {
      throw AppError.conflict(
        ErrorCodes.TASK_NOT_CANCELLABLE,
        `task is in terminal status ${task.status}`,
      );
    }

    if (task.status === TaskStatus.QUEUED || task.status === TaskStatus.RETRYING) {
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
          where: { id, status: { in: [TaskStatus.QUEUED, TaskStatus.RETRYING] } },
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
        if (isTerminalTaskStatus(task.status)) {
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

    const fresh = await prisma.task.findUnique({
      where: { id },
      include: { assets: { include: { asset: true } } },
    });
    return c.json(await serializeTask(fresh!));
  },
);

// POST /api/tasks/:id/retry — manually recover a RETRYING image task whose
// retry window has stopped scheduling automatic delayed jobs.
taskRoutes.post(
  '/tasks/:id/retry',
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
    if (task.type !== TaskType.IMAGE || task.status !== TaskStatus.RETRYING) {
      throw AppError.conflict(
        ErrorCodes.VALIDATION_FAILED,
        'only retrying image tasks can be manually recovered',
      );
    }

    const fresh = await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.RETRYING,
          nextRetryAt: new Date(),
          startedAt: null,
          completedAt: null,
        },
      });
      await tx.resourceImage.updateMany({
        where: { taskId: id },
        data: { status: TaskStatus.RETRYING },
      });
      return tx.task.findUnique({
        where: { id },
        include: { assets: { include: { asset: true } } },
      });
    });

    await enqueueTaskRetry(queueForTaskType(task.type), id);
    return c.json(await serializeTask(fresh!));
  },
);

function isTerminalTaskStatus(status: TaskStatus): boolean {
  return (
    status === TaskStatus.SUCCEEDED ||
    status === TaskStatus.FAILED ||
    status === TaskStatus.CANCELLED
  );
}

async function enqueueCreatedTaskOrRollback(
  taskId: string,
  ownerId: string,
  type: TaskType,
  reservedCredits: number,
  options: { priority?: number },
) {
  const queueName = queueForTaskType(type);
  try {
    await enqueueTaskJob(queueName, taskId, options);
    return;
  } catch (err) {
    const jobExists = await taskJobExistsAfterEnqueueError(queueName, taskId);
    if (jobExists) return;

    await rollbackUnqueuedTask(taskId, ownerId, reservedCredits);
    throw AppError.internal('failed to enqueue task; reservation was rolled back', {
      taskId,
      queueName,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

async function taskJobExistsAfterEnqueueError(
  queueName: ReturnType<typeof queueForTaskType>,
  taskId: string,
): Promise<boolean> {
  try {
    return await hasTaskJob(queueName, taskId);
  } catch {
    return false;
  }
}

async function rollbackUnqueuedTask(
  taskId: string,
  ownerId: string,
  reservedCredits: number,
) {
  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: {
        id: taskId,
        ownerId,
        status: TaskStatus.QUEUED,
        assets: { none: {} },
      },
      select: { id: true },
    });
    if (!task) return;

    const resourceImages = await tx.resourceImage.findMany({
      where: { taskId, ownerId, status: TaskStatus.QUEUED },
      select: { id: true },
    });
    const deletedTask = await tx.task.deleteMany({
      where: {
        id: taskId,
        ownerId,
        status: TaskStatus.QUEUED,
        assets: { none: {} },
      },
    });
    if (deletedTask.count === 0) return;

    const resourceImageIds = resourceImages.map((item) => item.id);
    if (resourceImageIds.length > 0) {
      await tx.resourceImage.deleteMany({
        where: { id: { in: resourceImageIds }, ownerId },
      });
    }
    if (reservedCredits > 0) {
      await tx.user.update({
        where: { id: ownerId },
        data: { credits: { increment: reservedCredits } },
      });
    }
  });
}

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
      if (isTerminalTaskStatus(body.status)) {
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

    const fresh = await prisma.task.findUnique({
      where: { id },
      include: { assets: { include: { asset: true } } },
    });
    return c.json(await serializeTask(fresh!));
  },
);
