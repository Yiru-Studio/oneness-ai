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
  [QueueNames.IMAGE]: 1,
  [QueueNames.VIDEO]: 1,
  [QueueNames.TEXT]:  4,
} as const;

/** BullMQ job data — minimal. Workers re-fetch Task row from DB. */
export type TaskJobData = { taskId: string };
