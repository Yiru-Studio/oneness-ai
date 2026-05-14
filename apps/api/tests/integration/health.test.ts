import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { healthRoutes } from '../../src/routes/health.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';
import { redis } from '../../src/lib/redis.js';

describe('GET /api/_health', () => {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.onError(errorHandler);
  app.route('/api', healthRoutes);

  beforeAll(async () => {
    // Touch the connections so the first test does not include cold-start time.
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });

  it('returns 200 with all checks "ok" when infra is up', async () => {
    const res = await app.request('/api/_health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: 'ok',
      checks: { database: 'ok', redis: 'ok', minio: 'ok' },
    });
  });

  it('_ready returns 200', async () => {
    const res = await app.request('/api/_ready');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready' });
  });

  it('/metrics returns 501', async () => {
    const res = await app.request('/api/metrics');
    expect(res.status).toBe(501);
  });
});
