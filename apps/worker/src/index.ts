import { Queue, Worker } from 'bullmq';
import { logger } from '@oneness/shared/logger';
import {
  DefaultTaskJobAttempts,
  QueueNames,
  type QueueName,
  type TaskJobData,
} from '@oneness/shared/queues';
import { config } from './config.js';
import { processTask } from './processor.js';
import { workerConcurrencyForQueue } from './lib/concurrency.js';
import { recoverStaleImageTasks } from './lib/stale-image-tasks.js';

const connection = { url: config.REDIS_URL };
const imageQueue = new Queue<TaskJobData>(QueueNames.IMAGE, { connection });

function scheduleImageStaleRecovery() {
  const runSweep = () => {
    void recoverStaleImageTasks(imageQueue, config.IMAGE_STALE_TASK_MS).catch((err) => {
      logger.error(
        { queue: QueueNames.IMAGE, err: err instanceof Error ? err.message : String(err) },
        'stale image task sweep failed',
      );
    });
  };
  runSweep();
  return setInterval(runSweep, config.IMAGE_STALE_SWEEP_INTERVAL_MS);
}

function startWorker(name: QueueName): Worker<TaskJobData> {
  const concurrency = workerConcurrencyForQueue(name);
  const w = new Worker<TaskJobData>(
    name,
    async (job) => {
      const startedAtMs = Date.now();
      const attempts = job.opts.attempts ?? DefaultTaskJobAttempts;
      logger.info(
        {
          queue: name,
          jobId: job.id,
          taskId: job.data.taskId,
          attemptsMade: job.attemptsMade,
          attempts,
        },
        'job processing started',
      );
      try {
        await processTask(job.data.taskId, {
          attemptsMade: job.attemptsMade,
          attempts,
          retryCount: job.data.retryCount,
          nextRetryAt: job.data.nextRetryAt,
        });
        logger.info(
          {
            queue: name,
            jobId: job.id,
            taskId: job.data.taskId,
            attemptsMade: job.attemptsMade,
            attempts,
            durationMs: Date.now() - startedAtMs,
          },
          'job processing completed',
        );
      } catch (err) {
        logger.warn(
          {
            queue: name,
            jobId: job.id,
            taskId: job.data.taskId,
            attemptsMade: job.attemptsMade,
            attempts,
            durationMs: Date.now() - startedAtMs,
            err: err instanceof Error ? err.message : String(err),
          },
          'job processing failed',
        );
        throw err;
      }
    },
    {
      connection,
      concurrency,
    },
  );
  w.on('failed', (job, err) => {
    logger.warn(
      { queue: name, jobId: job?.id, err: err.message },
      'job failed',
    );
  });
  w.on('error', (err) => {
    logger.error({ queue: name, err: err.message }, 'worker error');
  });
  logger.info(
    { queue: name, concurrency },
    'worker started',
  );
  return w;
}

const workers = [
  startWorker(QueueNames.IMAGE),
  startWorker(QueueNames.VIDEO),
  startWorker(QueueNames.TEXT),
];
const staleRecoveryInterval = scheduleImageStaleRecovery();

async function shutdown() {
  logger.info('shutting down workers');
  clearInterval(staleRecoveryInterval);
  await Promise.all(workers.map((w) => w.close()));
  await imageQueue.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
