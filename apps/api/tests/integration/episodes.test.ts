import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { episodeRoutes } from '../../src/routes/episodes.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';

const SEED_USER_EMAIL = '1280165525@qq.com';
const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', episodeRoutes);
const auth = { authorization: 'Bearer test_token' };

describe('episodes CRUD', () => {
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
    if (createdId) await prisma.storyboardEpisode.deleteMany({ where: { id: createdId } });
    await prisma.$disconnect();
  });

  it('GET returns the seeded episode 1', async () => {
    const res = await app.request(`/api/projects/${projectId}/episodes`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ number: number; analyzed: boolean }>;
    expect(body[0].number).toBe(1);
    expect(body[0].analyzed).toBe(true);
  });

  it('POST creates episode 2', async () => {
    const res = await app.request(`/api/projects/${projectId}/episodes`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ number: 999, title: '第999集', content: '测试' }),
    });
    expect(res.status).toBe(201);
    createdId = ((await res.json()) as { id: string }).id;
  });

  it('POST with duplicate number returns 409', async () => {
    const res = await app.request(`/api/projects/${projectId}/episodes`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ number: 1, title: 'duplicate', content: '' }),
    });
    expect(res.status).toBe(409);
  });

  it('DELETE removes the created one', async () => {
    const res = await app.request(`/api/episodes/${createdId}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(res.status).toBe(204);
    createdId = '';
  });
});
