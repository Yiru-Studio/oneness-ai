import { describe, expect, it } from 'vitest';
import { TaskStatus, TaskType } from '@oneness/shared/enums';
import { isRecoverableStaleImageTask } from '../src/lib/stale-image-tasks.js';

const now = new Date('2026-06-02T10:00:00.000Z');
const staleMs = 15 * 60 * 1000;
const oldStartedAt = new Date(now.getTime() - staleMs - 1);
const freshStartedAt = new Date(now.getTime() - staleMs + 1);

describe('stale image task recovery guard', () => {
  it('recovers old active image tasks when the BullMQ lock is missing', () => {
    expect(
      isRecoverableStaleImageTask({
        taskType: TaskType.IMAGE,
        taskStatus: TaskStatus.RUNNING,
        startedAt: oldStartedAt,
        now,
        staleMs,
        jobState: 'active',
        lockExists: false,
      }),
    ).toBe(true);
  });

  it('keeps old active image tasks when the BullMQ lock still exists', () => {
    expect(
      isRecoverableStaleImageTask({
        taskType: TaskType.IMAGE,
        taskStatus: TaskStatus.RUNNING,
        startedAt: oldStartedAt,
        now,
        staleMs,
        jobState: 'active',
        lockExists: true,
      }),
    ).toBe(false);
  });

  it('recovers old running image tasks that are no longer active in BullMQ', () => {
    expect(
      isRecoverableStaleImageTask({
        taskType: TaskType.IMAGE,
        taskStatus: TaskStatus.RUNNING,
        startedAt: oldStartedAt,
        now,
        staleMs,
        jobState: 'prioritized',
        lockExists: false,
      }),
    ).toBe(true);
  });

  it('ignores fresh image tasks', () => {
    expect(
      isRecoverableStaleImageTask({
        taskType: TaskType.IMAGE,
        taskStatus: TaskStatus.RUNNING,
        startedAt: freshStartedAt,
        now,
        staleMs,
        jobState: 'active',
        lockExists: false,
      }),
    ).toBe(false);
  });

  it('ignores non-image and non-running tasks', () => {
    expect(
      isRecoverableStaleImageTask({
        taskType: TaskType.TEXT_ANALYZE,
        taskStatus: TaskStatus.RUNNING,
        startedAt: oldStartedAt,
        now,
        staleMs,
        jobState: 'active',
        lockExists: false,
      }),
    ).toBe(false);

    expect(
      isRecoverableStaleImageTask({
        taskType: TaskType.IMAGE,
        taskStatus: TaskStatus.QUEUED,
        startedAt: oldStartedAt,
        now,
        staleMs,
        jobState: 'active',
        lockExists: false,
      }),
    ).toBe(false);
  });
});
