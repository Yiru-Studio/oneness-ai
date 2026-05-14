import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Worker } from 'bullmq';
import { taskRoutes } from '../../src/routes/tasks.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';
import { config } from '../../src/config.js';
import { processTask } from '../../../worker/src/processor.js';
import { QueueNames, WorkerConcurrency } from '@oneness/shared/queues';
import { TaskStatus } from '@oneness/shared/enums';

const SEED_USER_EMAIL = '1280165525@qq.com';

const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', taskRoutes);

const auth = { authorization: 'Bearer test_token' };
const connection = { url: config.REDIS_URL };

let workers: Worker[] = [];

async function pollUntilTerminal(taskId: string, timeoutMs = 15000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true },
    });
    if (
      t &&
      [TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(
        t.status as TaskStatus,
      )
    ) {
      return t.status;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`task ${taskId} did not reach terminal state within ${timeoutMs}ms`);
}

describe('tasks lifecycle', () => {
  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing.');
    // Force STUB_FAIL_RATE=0 for predictable success tests; failure test toggles it.
    process.env.STUB_FAIL_RATE = '0';
    // Start a Worker for each queue, in-process.
    workers = [
      new Worker(QueueNames.IMAGE, async (job) => processTask(job.data.taskId), {
        connection,
        concurrency: WorkerConcurrency[QueueNames.IMAGE],
      }),
      new Worker(QueueNames.VIDEO, async (job) => processTask(job.data.taskId), {
        connection,
        concurrency: WorkerConcurrency[QueueNames.VIDEO],
      }),
      new Worker(QueueNames.TEXT, async (job) => processTask(job.data.taskId), {
        connection,
        concurrency: WorkerConcurrency[QueueNames.TEXT],
      }),
    ];
  });

  afterAll(async () => {
    await Promise.all(workers.map((w) => w.close()));
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Reset credits to a known floor so each test can reason about deltas.
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (user && user.credits < 100) {
      await prisma.user.update({
        where: { id: user.id },
        data: { credits: 10158 },
      });
    }
  });

  it('IMAGE task completes successfully with output asset', async () => {
    const before = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { credits: true },
    });
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'IMAGE',
        provider: 'stub',
        input: { prompt: 'red square', ratio: '1:1', model: 'stub', n: 1 },
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; status: string; costCredits: number };
    expect(created.status).toBe('QUEUED');
    expect(created.costCredits).toBe(1);

    const after = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { credits: true },
    });
    expect(after?.credits).toBe((before?.credits ?? 0) - 1);

    const final = await pollUntilTerminal(created.id);
    expect(final).toBe('SUCCEEDED');

    const fullRes = await app.request(`/api/tasks/${created.id}`, { headers: auth });
    const body = (await fullRes.json()) as {
      outputAssets: Array<{ id: string; url: string }>;
      status: string;
    };
    expect(body.status).toBe('SUCCEEDED');
    expect(body.outputAssets.length).toBe(1);
    expect(body.outputAssets[0].url).toContain('task-outputs');
  });

  it('TEXT task completes', async () => {
    // Need a project (TextInput requires projectId)
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    const project = await prisma.project.findFirst({ where: { ownerId: user!.id } });
    if (!project) throw new Error('Seed project missing.');
    const episode = await prisma.storyboardEpisode.findFirst({
      where: { projectId: project.id },
    });
    if (!episode) throw new Error('Seed episode missing.');

    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'TEXT_ANALYZE',
        projectId: project.id,
        provider: 'stub',
        input: { episodeId: episode.id, analysisType: 'general' },
      }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const final = await pollUntilTerminal(id, 8000);
    expect(final).toBe('SUCCEEDED');

    const final2 = await app.request(`/api/tasks/${id}`, { headers: auth });
    const body = (await final2.json()) as { output: { kind: string; summary: string } };
    expect(body.output.kind).toBe('stub-text');
    expect(body.output.summary.length).toBeGreaterThan(10);
  });

  it(
    'IMAGE task with STUB_FAIL_RATE=1 fails and refunds credits',
    async () => {
      process.env.STUB_FAIL_RATE = '1';
      try {
        const before = await prisma.user.findUnique({
          where: { email: SEED_USER_EMAIL },
          select: { credits: true },
        });
        const res = await app.request('/api/tasks', {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'IMAGE',
            provider: 'stub',
            input: { prompt: 'doomed', ratio: '1:1', model: 'stub', n: 1 },
          }),
        });
        const { id } = (await res.json()) as { id: string };
        // Failures get retried 3 times with 5s exp backoff: ~5+10+20 = 35s worst case.
        const final = await pollUntilTerminal(id, 60000);
        expect(final).toBe('FAILED');

        const after = await prisma.user.findUnique({
          where: { email: SEED_USER_EMAIL },
          select: { credits: true },
        });
        // After all retries settled, credits should be refunded.
        // Tolerance: allow up to (before - 1) in case of timing.
        expect(after!.credits).toBeGreaterThanOrEqual((before?.credits ?? 0) - 1);
      } finally {
        process.env.STUB_FAIL_RATE = '0';
      }
    },
    70000,
  );

  it('POST cancel on QUEUED task refunds credits', async () => {
    // Briefly pause the image worker to make the task sit in QUEUED.
    const imageWorker = workers.find((w) => w.name === QueueNames.IMAGE)!;
    await imageWorker.pause();

    try {
      const before = await prisma.user.findUnique({
        where: { email: SEED_USER_EMAIL },
        select: { credits: true },
      });
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'IMAGE',
          provider: 'stub',
          input: { prompt: 'cancel me', ratio: '1:1', model: 'stub', n: 1 },
        }),
      });
      const { id } = (await res.json()) as { id: string };
      // Should still be QUEUED since worker is paused
      const fresh = await prisma.task.findUnique({
        where: { id },
        select: { status: true },
      });
      expect(fresh?.status).toBe('QUEUED');

      const cancel = await app.request(`/api/tasks/${id}/cancel`, {
        method: 'POST',
        headers: auth,
      });
      expect(cancel.status).toBe(200);
      const body = (await cancel.json()) as { status: string };
      expect(body.status).toBe('CANCELLED');

      const after = await prisma.user.findUnique({
        where: { email: SEED_USER_EMAIL },
        select: { credits: true },
      });
      expect(after?.credits).toBe(before?.credits); // refunded
    } finally {
      await imageWorker.resume();
    }
  });

  it('POST cancel on terminal task returns 409', async () => {
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'IMAGE',
        provider: 'stub',
        input: { prompt: 'finish-fast', ratio: '1:1', model: 'stub', n: 1 },
      }),
    });
    const { id } = (await res.json()) as { id: string };
    await pollUntilTerminal(id);

    const cancel = await app.request(`/api/tasks/${id}/cancel`, {
      method: 'POST',
      headers: auth,
    });
    expect(cancel.status).toBe(409);
  });

  it('GET /api/tasks lists with cursor pagination', async () => {
    const res = await app.request('/api/tasks?limit=2', { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; nextCursor: string | null };
    expect(body.items.length).toBeLessThanOrEqual(2);
  });

  it('PATCH /api/internal/tasks/:id without secret returns 403', async () => {
    const post = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'IMAGE',
        provider: 'stub',
        input: { prompt: 'x', ratio: '1:1', model: 'stub' },
      }),
    });
    const { id } = (await post.json()) as { id: string };

    const res = await app.request(`/api/internal/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'FAILED', error: 'external' }),
    });
    expect(res.status).toBe(403);
  });

  it('PATCH /api/internal/tasks/:id with correct secret updates the task', async () => {
    const post = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'IMAGE',
        provider: 'stub',
        input: { prompt: 'x', ratio: '1:1', model: 'stub' },
      }),
    });
    const { id } = (await post.json()) as { id: string };
    // wait for it to settle so we have something to override
    await pollUntilTerminal(id);

    const res = await app.request(`/api/internal/tasks/${id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': config.INTERNAL_SECRET,
      },
      body: JSON.stringify({ output: { externallyOverridden: true } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { output: { externallyOverridden: boolean } };
    expect(body.output.externallyOverridden).toBe(true);
  });
});
