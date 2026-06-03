import { TaskType } from './enums.js';

export const QueueNames = {
  IMAGE: 'ai-image',
  VIDEO: 'ai-video',
  TEXT:  'ai-text',
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

export const DefaultTaskJobAttempts = 3;

export function queueForTaskType(type: TaskType): QueueName {
  switch (type) {
    case TaskType.IMAGE:        return QueueNames.IMAGE;
    case TaskType.VIDEO:        return QueueNames.VIDEO;
    case TaskType.TEXT_ANALYZE: return QueueNames.TEXT;
  }
}

export const WorkerConcurrency = {
  [QueueNames.IMAGE]: 2,
  [QueueNames.VIDEO]: 1,
  [QueueNames.TEXT]:  4,
} as const;

/**
 * BullMQ job data. Workers still re-fetch Task rows from DB; retry metadata is
 * only a freshness guard so stale delayed jobs cannot revive older retries.
 */
export type TaskJobData = {
  taskId: string;
  retryCount?: number;
  nextRetryAt?: string;
};
