import { Queue, type JobState } from 'bullmq';
import { logger } from '@oneness/shared/logger';
import { QueueNames, type TaskJobData } from '@oneness/shared/queues';
import { TaskStatus, TaskType } from '@oneness/shared/enums';
import { prisma } from './prisma.js';
import { redis } from './redis.js';

export const STALE_IMAGE_TASK_ERROR =
  'worker[stale_active]: image task exceeded recovery window';

type RecoverableStaleImageTaskInput = {
  taskType: string;
  taskStatus: string;
  startedAt: Date | null;
  now: Date;
  staleMs: number;
  jobState: JobState | 'unknown' | null;
  lockExists: boolean;
};

type StaleRecoveryResult = {
  scanned: number;
  recovered: number;
};

export function isRecoverableStaleImageTask({
  taskType,
  taskStatus,
  startedAt,
  now,
  staleMs,
  jobState,
  lockExists,
}: RecoverableStaleImageTaskInput): boolean {
  if (taskType !== TaskType.IMAGE) return false;
  if (taskStatus !== TaskStatus.RUNNING) return false;
  if (!startedAt) return false;
  if (now.getTime() - startedAt.getTime() < staleMs) return false;
  if (jobState === 'active') return !lockExists;
  return true;
}

export async function recoverStaleImageTasks(
  queue: Queue<TaskJobData>,
  staleMs: number,
): Promise<StaleRecoveryResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - staleMs);
  const tasks = await prisma.task.findMany({
    where: {
      type: TaskType.IMAGE,
      status: TaskStatus.RUNNING,
      startedAt: { lt: cutoff },
    },
    select: {
      id: true,
      ownerId: true,
      type: true,
      status: true,
      provider: true,
      startedAt: true,
      costCredits: true,
    },
    orderBy: { startedAt: 'asc' },
    take: 50,
  });

  let recovered = 0;
  for (const task of tasks) {
    const job = await queue.getJob(task.id);
    const jobState = job ? await job.getState() : null;
    const lockExists = await imageJobLockExists(queue, task.id);
    const shouldRecover = isRecoverableStaleImageTask({
      taskType: task.type,
      taskStatus: task.status,
      startedAt: task.startedAt,
      now,
      staleMs,
      jobState,
      lockExists,
    });

    if (!shouldRecover) continue;

    const reason =
      jobState === 'active' && !lockExists ? 'active_without_lock' : 'not_active';
    await removeStaleImageJob(queue, task.id, jobState);
    const marked = await markImageTaskStaleFailed(task);
    if (!marked) continue;
    recovered += 1;
    logger.warn(
      {
        queue: QueueNames.IMAGE,
        jobId: task.id,
        taskId: task.id,
        provider: task.provider,
        startedAt: task.startedAt?.toISOString() ?? null,
        staleMs,
        jobState,
        lockExists,
        reason,
      },
      'stale image task recovered as failed',
    );
  }

  if (tasks.length > 0 || recovered > 0) {
    logger.info(
      { queue: QueueNames.IMAGE, scanned: tasks.length, recovered, staleMs },
      'stale image task sweep complete',
    );
  }
  return { scanned: tasks.length, recovered };
}

async function imageJobLockExists(queue: Queue<TaskJobData>, jobId: string): Promise<boolean> {
  return (await redis.exists(queue.toKey(`${jobId}:lock`))) > 0;
}

async function removeStaleImageJob(
  queue: Queue<TaskJobData>,
  jobId: string,
  jobState: JobState | 'unknown' | null,
) {
  if (jobState === 'active') {
    await redis.lrem(queue.toKey('active'), 0, jobId);
  }
  try {
    await queue.remove(jobId);
  } catch (err) {
    logger.warn(
      {
        queue: QueueNames.IMAGE,
        jobId,
        jobState,
        err: err instanceof Error ? err.message : String(err),
      },
      'failed to remove stale image job from queue',
    );
  }
}

async function markImageTaskStaleFailed(task: {
  id: string;
  ownerId: string;
  costCredits: number;
}): Promise<boolean> {
  const now = new Date();
  const runs = await prisma.compositionImageRun.findMany({
    where: { taskJobId: task.id },
    select: { id: true, taskId: true },
  });

  const updatedTask = await prisma.$transaction(async (tx) => {
    const taskUpdate = await tx.task.updateMany({
      where: { id: task.id, status: TaskStatus.RUNNING },
      data: {
        status: TaskStatus.FAILED,
        error: STALE_IMAGE_TASK_ERROR,
        completedAt: now,
      },
    });
    if (taskUpdate.count === 0) return false;

    if (task.costCredits > 0) {
      await tx.user.update({
        where: { id: task.ownerId },
        data: { credits: { increment: task.costCredits } },
      });
    }

    await tx.resourceImage.updateMany({
      where: { taskId: task.id },
      data: {
        status: TaskStatus.FAILED,
        error: STALE_IMAGE_TASK_ERROR,
      },
    });

    await tx.compositionImageRun.updateMany({
      where: { taskJobId: task.id },
      data: {
        status: TaskStatus.FAILED,
        error: STALE_IMAGE_TASK_ERROR,
      },
    });

    for (const run of runs) {
      await tx.compositionTask.updateMany({
        where: { id: run.taskId, currentImageRunId: run.id },
        data: {
          status: 'IMAGE_FAILED',
          error: STALE_IMAGE_TASK_ERROR,
          imageAssetId: null,
          imageTaskId: task.id,
        },
      });
    }

    return true;
  });

  return updatedTask;
}

export async function countStaleRunningImageTasks(staleMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs);
  return prisma.task.count({
    where: {
      type: TaskType.IMAGE,
      status: TaskStatus.RUNNING,
      startedAt: { lt: cutoff },
    },
  });
}

export async function listStaleRunningImageTasks(staleMs: number) {
  const cutoff = new Date(Date.now() - staleMs);
  return prisma.task.findMany({
    where: {
      type: TaskType.IMAGE,
      status: TaskStatus.RUNNING,
      startedAt: { lt: cutoff },
    },
    select: {
      id: true,
      projectId: true,
      provider: true,
      startedAt: true,
      error: true,
      resourceImages: {
        select: {
          id: true,
          kind: true,
          status: true,
          characterId: true,
          characterStyleId: true,
          sceneId: true,
          itemId: true,
        },
        take: 3,
      },
      compositionImageRunJobs: {
        select: {
          id: true,
          taskId: true,
          status: true,
        },
        take: 3,
      },
    },
    orderBy: { startedAt: 'asc' },
    take: 20,
  });
}
