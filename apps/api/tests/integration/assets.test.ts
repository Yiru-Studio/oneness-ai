import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import sharp from 'sharp';
import { assetRoutes } from '../../src/routes/assets.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';
import { minioClient, Buckets } from '../../src/lib/minio.js';

const SEED_USER_EMAIL = '1280165525@qq.com';

const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', assetRoutes);

async function authHeader(): Promise<Record<string, string>> {
  // Any Bearer value loads the seed user — Plan 1 mock auth.
  return { authorization: 'Bearer test_token' };
}

async function makePng(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 16, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer();
}

describe('POST /api/assets', () => {
  beforeAll(async () => {
    // Ensure seed user exists; reset doesn't run automatically per file
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing. Run pnpm db:seed.');
  });

  afterAll(async () => {
    // Best-effort cleanup of test-uploaded assets
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) return;
    const orphans = await prisma.asset.findMany({
      where: { ownerId: user.id, contentType: 'image/png', sizeBytes: { lt: 500 } },
    });
    for (const a of orphans) {
      await minioClient.removeObject(a.bucket, a.key).catch(() => {});
      await prisma.asset.delete({ where: { id: a.id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('uploads a png and returns a presigned url + dimensions', async () => {
    const png = await makePng();
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'red.png');
    const res = await app.request('/api/assets', {
      method: 'POST',
      headers: await authHeader(),
      body: fd,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      url: string;
      contentType: string;
      sizeBytes: number;
      width: number | null;
      height: number | null;
    };
    expect(body.contentType).toBe('image/png');
    expect(body.width).toBe(32);
    expect(body.height).toBe(16);
    expect(body.sizeBytes).toBe(png.byteLength);
    expect(body.url).toContain(Buckets.USER_UPLOADS);

    // Confirm DB row created
    const row = await prisma.asset.findUnique({ where: { id: body.id } });
    expect(row?.bucket).toBe(Buckets.USER_UPLOADS);

    // DELETE round-trip
    const del = await app.request(`/api/assets/${body.id}`, {
      method: 'DELETE',
      headers: await authHeader(),
    });
    expect(del.status).toBe(204);
    const after = await prisma.asset.findUnique({ where: { id: body.id } });
    expect(after).toBeNull();
  });

  it('rejects unsupported content type', async () => {
    const fd = new FormData();
    fd.append(
      'file',
      new Blob(['hello'], { type: 'application/x-executable' }),
      'bad.bin',
    );
    const res = await app.request('/api/assets', {
      method: 'POST',
      headers: await authHeader(),
      body: fd,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ASSET_TYPE_NOT_ALLOWED');
  });

  it('rejects DELETE for unknown id', async () => {
    const res = await app.request('/api/assets/notarealid01234567890', {
      method: 'DELETE',
      headers: await authHeader(),
    });
    // Either 400 (zod cuid pattern reject) or 404 (lookup miss). Both are acceptable
    // for this contract; we just ensure it's not 204.
    expect([400, 404]).toContain(res.status);
  });

  it('requires auth', async () => {
    const fd = new FormData();
    fd.append('file', new Blob(['x'], { type: 'image/png' }), 'x.png');
    const res = await app.request('/api/assets', { method: 'POST', body: fd });
    expect(res.status).toBe(401);
  });
});
