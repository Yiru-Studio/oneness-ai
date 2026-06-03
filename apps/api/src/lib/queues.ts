import { Queue } from 'bullmq';
import { config } from '../config.js';
import {
  DefaultTaskJobAttempts,
  QueueNames,
  type QueueName,
  type TaskJobData,
} from '@oneness/shared/queues';

const connection = { url: config.REDIS_URL };

const queueOptions = {
  connection,
  defaultJobOptions: {
    attempts: DefaultTaskJobAttempts,
    backoff: { type: 'exponential' as const, delay: 5000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 200 },
  },
};

export const queues: Record<QueueName, Queue<TaskJobData>> = {
  [QueueNames.IMAGE]: new Queue<TaskJobData>(QueueNames.IMAGE, queueOptions),
  [QueueNames.VIDEO]: new Queue<TaskJobData>(QueueNames.VIDEO, queueOptions),
  [QueueNames.TEXT]:  new Queue<TaskJobData>(QueueNames.TEXT,  queueOptions),
};

export const QueueJobPriority = {
  INTERACTIVE_IMAGE: 1,
  NORMAL: 5,
  BACKGROUND: 20,
} as const;

type EnqueueTaskJobOptions = {
  priority?: number;
  delayMs?: number;
};

export async function enqueueTaskJob(
  queueName: QueueName,
  taskId: string,
  options: EnqueueTaskJobOptions = {},
) {
  await queues[queueName].add('process-task', { taskId }, {
    jobId: taskId,
    ...(options.priority === undefined ? {} : { priority: options.priority }),
    ...(options.delayMs === undefined ? {} : { delay: options.delayMs }),
  });
}

export async function hasTaskJob(queueName: QueueName, taskId: string): Promise<boolean> {
  return Boolean(await queues[queueName].getJob(taskId));
}

export async function removeTaskJob(queueName: QueueName, taskId: string) {
  const job = await queues[queueName].getJob(taskId);
  const retryJobs = await findRetryJobs(queueName, taskId);
  for (const candidate of [job, ...retryJobs]) {
    if (!candidate) continue;
    try {
      await candidate.remove();
    } catch {
      // Best effort: a worker may lock the job between DB cancellation and
      // BullMQ removal. The worker polls Task.status and will abort/refund.
    }
  }
}

async function findRetryJobs(queueName: QueueName, taskId: string) {
  const queue = queues[queueName];
  const jobs = await queue.getJobs(['delayed', 'waiting', 'prioritized'], 0, 1000);
  return jobs.filter((job) => job.data.taskId === taskId);
}

export async function enqueueTaskRetry(queueName: QueueName, taskId: string) {
  await removeTaskJob(queueName, taskId);
  await queues[queueName].add('process-task', { taskId }, {
    jobId: `${taskId}-manual-${Date.now()}`,
    attempts: 1,
    priority: QueueJobPriority.INTERACTIVE_IMAGE,
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 200 },
  });
}

export async function closeQueues() {
  await Promise.all(Object.values(queues).map((q) => q.close()));
}
