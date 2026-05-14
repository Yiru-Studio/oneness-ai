import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { knowledgeDocRoutes } from '../../src/routes/knowledge-docs.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';

const SEED_USER_EMAIL = '1280165525@qq.com';
const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', knowledgeDocRoutes);
const auth = { authorization: 'Bearer test_token' };

describe('knowledge-docs CRUD', () => {
  let userId: string;
  let createdId = '';

  beforeAll(async () => {
    const u = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!u) throw new Error('Seed user missing.');
    userId = u.id;
  });

  afterAll(async () => {
    if (createdId) await prisma.knowledgeDoc.deleteMany({ where: { id: createdId } });
    // also clean any leftover test docs by title
    await prisma.knowledgeDoc.deleteMany({ where: { ownerId: userId, title: '测试文档' } });
    await prisma.$disconnect();
  });

  it('GET empty initially (no seed knowledge docs)', async () => {
    const res = await app.request('/api/knowledge-docs', { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.total).toBe(0);
  });

  it('POST creates, GET filters by type', async () => {
    const post = await app.request('/api/knowledge-docs', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '测试文档', type: 'CREATED', content: 'lorem' }),
    });
    expect(post.status).toBe(201);
    createdId = ((await post.json()) as { id: string }).id;

    const list = await app.request('/api/knowledge-docs?type=CREATED', { headers: auth });
    const body = (await list.json()) as { items: Array<{ type: string }> };
    expect(body.items.every((d) => d.type === 'created')).toBe(true);

    const empty = await app.request('/api/knowledge-docs?type=FAVORITED', { headers: auth });
    const emptyBody = (await empty.json()) as { total: number };
    expect(emptyBody.total).toBe(0);
  });

  it('DELETE removes the doc', async () => {
    const res = await app.request(`/api/knowledge-docs/${createdId}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(res.status).toBe(204);
    createdId = '';
  });
});
