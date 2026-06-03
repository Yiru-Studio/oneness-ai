import type { ResourceImageStatus, ShotVideoTaskStatus } from '@/types';

export type TaskLikeStatus = ResourceImageStatus | ShotVideoTaskStatus | string | null | undefined;

export function isTaskPending(status: TaskLikeStatus): boolean {
  return status === 'QUEUED' || status === 'RUNNING' || status === 'RETRYING';
}

export function taskPendingLabel(status: TaskLikeStatus, runningLabel = '生成中'): string | null {
  if (status === 'QUEUED') return '排队中';
  if (status === 'RETRYING') return '等待重试';
  if (status === 'RUNNING') return runningLabel;
  return null;
}
