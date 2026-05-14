import { Hono } from 'hono';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { minioClient } from '../lib/minio.js';

export const healthRoutes = new Hono();

type CheckResult = 'ok' | 'error';

async function check(fn: () => Promise<unknown>): Promise<CheckResult> {
  try {
    await fn();
    return 'ok';
  } catch {
    return 'error';
  }
}

healthRoutes.get('/_health', async (c) => {
  const [database, redisRes, minio] = await Promise.all([
    check(() => prisma.$queryRaw`SELECT 1`),
    check(() => redis.ping()),
    check(() => minioClient.listBuckets()),
  ]);
  const ok = database === 'ok' && redisRes === 'ok' && minio === 'ok';
  return c.json(
    { status: ok ? 'ok' : 'degraded', checks: { database, redis: redisRes, minio } },
    ok ? 200 : 503,
  );
});

healthRoutes.get('/_ready', (c) => c.json({ status: 'ready' }));

healthRoutes.get('/metrics', (c) =>
  c.json(
    { error: { code: 'NOT_IMPLEMENTED', message: 'wire prom-client here' } },
    501,
  ),
);
