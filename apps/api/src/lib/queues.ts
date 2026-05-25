import { Queue } from 'bullmq';
import { config } from '../config.js';
import { QueueNames, type QueueName, type TaskJobData } from '@oneness/shared/queues';

const connection = { url: config.REDIS_URL };

const queueOptions = {
  connection,
  defaultJobOptions: {
    attempts: 3,
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
};

export async function enqueueTaskJob(
  queueName: QueueName,
  taskId: string,
  options: EnqueueTaskJobOptions = {},
) {
  await queues[queueName].add('process-task', { taskId }, {
    jobId: taskId,
    ...(options.priority === undefined ? {} : { priority: options.priority }),
  });
}

export async function removeTaskJob(queueName: QueueName, taskId: string) {
  const job = await queues[queueName].getJob(taskId);
  if (job) await job.remove();
}

export async function closeQueues() {
  await Promise.all(Object.values(queues).map((q) => q.close()));
}
