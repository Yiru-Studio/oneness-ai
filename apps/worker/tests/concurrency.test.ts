import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueueNames } from '@oneness/shared/queues';

async function loadConcurrencyModule() {
  return await import('../src/lib/concurrency.js');
}

describe('worker queue concurrency', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults image concurrency to 4', async () => {
    const { workerConcurrencyForQueue } = await loadConcurrencyModule();

    expect(workerConcurrencyForQueue(QueueNames.IMAGE)).toBe(4);
  });

  it('uses IMAGE_WORKER_CONCURRENCY for image workers', async () => {
    vi.stubEnv('IMAGE_WORKER_CONCURRENCY', '6');
    vi.resetModules();

    const { config } = await import('../src/config.js');
    const { workerConcurrencyForQueue } = await loadConcurrencyModule();

    expect(config.IMAGE_WORKER_CONCURRENCY).toBe(6);
    expect(workerConcurrencyForQueue(QueueNames.IMAGE)).toBe(6);
  });

  it('keeps text and video concurrency unchanged', async () => {
    const { workerConcurrencyForQueue } = await loadConcurrencyModule();

    expect(workerConcurrencyForQueue(QueueNames.TEXT, 6)).toBe(4);
    expect(workerConcurrencyForQueue(QueueNames.VIDEO, 6)).toBe(1);
  });
});
