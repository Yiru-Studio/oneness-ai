import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { projectRoutes } from '../../src/routes/projects.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';

const SEED_USER_EMAIL = '1280165525@qq.com';

const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', projectRoutes);

const auth = { authorization: 'Bearer test_token' };

describe('projects CRUD', () => {
  let createdId: string;

  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing. Run pnpm db:seed.');
  });

  afterAll(async () => {
    if (createdId) await prisma.project.deleteMany({ where: { id: createdId } });
    await prisma.$disconnect();
  });

  it('GET /projects returns the seeded 2 projects', async () => {
    const res = await app.request('/api/projects', { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('POST /projects creates and returns 201', async () => {
    const payload = {
      name: '测试项目',
      ratio: '16:9',
      style: '测试风格',
      stylePrompt: '一段测试 prompt',
      analysisModel: 'Gemini 3 Pro',
      imageModel: 'Nano banana pro',
      videoModel: 'Seedance 2.0',
    };
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; generalAnalysis: string };
    expect(body.name).toBe('测试项目');
    expect(body.generalAnalysis).toBe('pending');
    createdId = body.id;
  });

  it('GET /projects/:id returns the created project', async () => {
    const res = await app.request(`/api/projects/${createdId}`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(createdId);
  });

  it('PATCH /projects/:id updates name', async () => {
    const res = await app.request(`/api/projects/${createdId}`, {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试项目-改名' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('测试项目-改名');
  });

  it('DELETE /projects/:id returns 204 and the row is gone', async () => {
    const res = await app.request(`/api/projects/${createdId}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(res.status).toBe(204);
    const after = await app.request(`/api/projects/${createdId}`, { headers: auth });
    expect(after.status).toBe(404);
    createdId = ''; // avoid double cleanup
  });

  it('rejects requests with no auth', async () => {
    const res = await app.request('/api/projects');
    expect(res.status).toBe(401);
  });

  it('search filters by name', async () => {
    const res = await app.request('/api/projects?search=动画', { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ name: string }> };
    expect(body.items.every((p) => p.name.includes('动画'))).toBe(true);
  });

  it('GET /projects/:id/analytics returns zeros for a fresh project', async () => {
    // Use an ephemeral project so this assertion is isolated from any tasks
    // created by tasks.test.ts (which targets seed projects).
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing.');
    const fresh = await prisma.project.create({
      data: {
        ownerId: user.id,
        name: `analytics-isolation-${Date.now()}`,
        ratio: '16:9',
        style: 'test',
        stylePrompt: '',
        analysisModel: 'stub',
        imageModel: 'stub',
        videoModel: 'stub',
      },
    });
    try {
      const res = await app.request(`/api/projects/${fresh.id}/analytics`, { headers: auth });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        totalCredits: number;
        imageCount: number;
        videoCount: number;
        textTaskCount: number;
        updateTime: string;
      };
      expect(body.totalCredits).toBe(0);
      expect(body.imageCount).toBe(0);
      expect(body.videoCount).toBe(0);
      expect(body.textTaskCount).toBe(0);
      expect(typeof body.updateTime).toBe('string');
    } finally {
      await prisma.project.delete({ where: { id: fresh.id } });
    }
  });
});
