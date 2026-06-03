import { describe, expect, it, vi } from 'vitest';
import { QueueNames } from '@oneness/shared/queues';

const queueMocks = vi.hoisted(() => ({
  add: vi.fn(),
  close: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => queueMocks),
}));

describe('retry queue', () => {
  it('enqueues delayed retry jobs with freshness metadata', async () => {
    const { enqueueRetryTaskJob } = await import('../src/lib/retry-queue.js');
    const nextRetryAt = new Date('2026-06-03T10:00:10.000Z');

    await enqueueRetryTaskJob({
      taskId: 'task-1',
      delayMs: 10_000,
      retryCount: 2,
      nextRetryAt,
    });

    expect(queueMocks.add).toHaveBeenCalledWith(
      'process-task',
      {
        taskId: 'task-1',
        retryCount: 2,
        nextRetryAt: '2026-06-03T10:00:10.000Z',
      },
      {
        jobId: `task-1-retry-2-${nextRetryAt.getTime()}`,
        delay: 10_000,
        attempts: 1,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
      },
    );
  });

  it('uses the image queue', async () => {
    const { Queue } = await import('bullmq');
    await import('../src/lib/retry-queue.js');

    expect(Queue).toHaveBeenCalledWith(QueueNames.IMAGE, expect.any(Object));
  });
});
