import { Queue } from 'bullmq';
import { QueueNames, type TaskJobData } from '@oneness/shared/queues';
import { config } from '../config.js';

const connection = { url: config.REDIS_URL };
const imageQueue = new Queue<TaskJobData>(QueueNames.IMAGE, { connection });

export async function enqueueRetryTaskJob(args: {
  taskId: string;
  delayMs: number;
  retryCount: number;
  nextRetryAt: Date;
}) {
  await imageQueue.add('process-task', {
    taskId: args.taskId,
    retryCount: args.retryCount,
    nextRetryAt: args.nextRetryAt.toISOString(),
  }, {
    jobId: `${args.taskId}-retry-${args.retryCount}-${args.nextRetryAt.getTime()}`,
    delay: args.delayMs,
    attempts: 1,
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 200 },
  });
}

export async function closeRetryQueue() {
  await imageQueue.close();
}
