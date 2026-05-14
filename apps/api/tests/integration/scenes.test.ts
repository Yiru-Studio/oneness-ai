import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { sceneRoutes } from '../../src/routes/scenes.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';

const SEED_USER_EMAIL = '1280165525@qq.com';
const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', sceneRoutes);
const auth = { authorization: 'Bearer test_token' };

describe('scenes CRUD', () => {
  let projectId: string;
  let createdId = '';

  beforeAll(async () => {
    const u = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!u) throw new Error('Seed user missing.');
    const p = await prisma.project.findFirst({
      where: { ownerId: u.id, name: '格斗动画' },
    });
    if (!p) throw new Error('Seed project missing.');
    projectId = p.id;
  });

  afterAll(async () => {
    if (createdId) await prisma.scene.deleteMany({ where: { id: createdId } });
    await prisma.$disconnect();
  });

  it('GET returns the 16 seeded scenes', async () => {
    const res = await app.request(`/api/projects/${projectId}/scenes`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body.length).toBe(16);
  });

  it('POST/PATCH/DELETE round-trip', async () => {
    const post = await app.request(`/api/projects/${projectId}/scenes`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试场景' }),
    });
    expect(post.status).toBe(201);
    createdId = ((await post.json()) as { id: string }).id;

    const patch = await app.request(`/api/scenes/${createdId}`, {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试场景-改' }),
    });
    expect(((await patch.json()) as { name: string }).name).toBe('测试场景-改');

    const del = await app.request(`/api/scenes/${createdId}`, { method: 'DELETE', headers: auth });
    expect(del.status).toBe(204);
    createdId = '';
  });
});
