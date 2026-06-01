import { Worker } from 'bullmq';
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

const connection = { url: config.REDIS_URL };

function startWorker(name: QueueName): Worker<TaskJobData> {
  const concurrency = workerConcurrencyForQueue(name);
  const w = new Worker<TaskJobData>(
    name,
    async (job) => {
      await processTask(job.data.taskId, {
        attemptsMade: job.attemptsMade,
        attempts: job.opts.attempts ?? DefaultTaskJobAttempts,
      });
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

async function shutdown() {
  logger.info('shutting down workers');
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
