import { Queue } from 'bullmq';
import { QueueNames, type TaskJobData } from '@oneness/shared/queues';
import { config } from '../src/config.js';
import { prisma } from '../src/lib/prisma.js';
import { redis } from '../src/lib/redis.js';
import { countStaleRunningImageTasks, listStaleRunningImageTasks } from '../src/lib/stale-image-tasks.js';

const imageQueue = new Queue<TaskJobData>(QueueNames.IMAGE, {
  connection: { url: config.REDIS_URL },
});

async function main() {
  const [counts, activeJobIds, staleRunningImageTaskCount, staleRunningImageTasks] =
    await Promise.all([
      imageQueue.getJobCounts(
        'waiting',
        'wait',
        'prioritized',
        'active',
        'delayed',
        'failed',
        'completed',
      ),
      redis.lrange(imageQueue.toKey('active'), 0, -1),
      countStaleRunningImageTasks(config.IMAGE_STALE_TASK_MS),
      listStaleRunningImageTasks(config.IMAGE_STALE_TASK_MS),
    ]);

  process.stdout.write(
    `${JSON.stringify(
      {
        queue: QueueNames.IMAGE,
        imageWorkerConcurrency: config.IMAGE_WORKER_CONCURRENCY,
        imageTaskTimeoutMs: config.IMAGE_TASK_TIMEOUT_MS,
        imageStaleTaskMs: config.IMAGE_STALE_TASK_MS,
        counts,
        activeJobIds,
        staleRunningImageTaskCount,
        staleRunningImageTasks,
      },
      null,
      2,
    )}\n`,
  );
}

try {
  await main();
} finally {
  await imageQueue.close();
  await prisma.$disconnect();
  await redis.quit();
}
