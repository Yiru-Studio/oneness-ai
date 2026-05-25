import {
  QueueNames,
  WorkerConcurrency,
  type QueueName,
} from '@oneness/shared/queues';
import { config } from '../config.js';

export function workerConcurrencyForQueue(
  name: QueueName,
  imageConcurrency = config.IMAGE_WORKER_CONCURRENCY,
): number {
  if (name === QueueNames.IMAGE) return imageConcurrency;
  return WorkerConcurrency[name];
}
