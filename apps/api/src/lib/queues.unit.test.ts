import { describe, expect, it, vi } from 'vitest';
import { QueueNames } from '@oneness/shared/queues';

type MockQueue = {
  add: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  getJob: ReturnType<typeof vi.fn>;
};

const queueMocks = vi.hoisted(() => ({
  instances: {} as Record<string, MockQueue>,
}));

vi.mock('bullmq', () => {
  return {
    Queue: vi.fn().mockImplementation((name: string) => {
      const instance: MockQueue = {
        add: vi.fn(),
        close: vi.fn(),
        getJob: vi.fn(),
      };
      queueMocks.instances[name] = instance;
      return instance;
    }),
  };
});

describe('queue helpers', () => {
  it('enqueues image jobs with interactive priority', async () => {
    const { enqueueTaskJob, QueueJobPriority } = await import('./queues.js');

    await enqueueTaskJob(QueueNames.IMAGE, 'task-image-1', {
      priority: QueueJobPriority.INTERACTIVE_IMAGE,
    });

    expect(queueMocks.instances[QueueNames.IMAGE].add).toHaveBeenCalledWith(
      'process-task',
      { taskId: 'task-image-1' },
      { jobId: 'task-image-1', priority: QueueJobPriority.INTERACTIVE_IMAGE },
    );
  });

  it('keeps priority optional for normal jobs', async () => {
    const { enqueueTaskJob } = await import('./queues.js');

    await enqueueTaskJob(QueueNames.TEXT, 'task-text-1');

    expect(queueMocks.instances[QueueNames.TEXT].add).toHaveBeenCalledWith(
      'process-task',
      { taskId: 'task-text-1' },
      { jobId: 'task-text-1' },
    );
  });
});
