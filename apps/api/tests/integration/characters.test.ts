import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { characterRoutes } from '../../src/routes/characters.js';
import { projectRoutes } from '../../src/routes/projects.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';

const SEED_USER_EMAIL = '1280165525@qq.com';

const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', projectRoutes);
app.route('/api', characterRoutes);

const auth = { authorization: 'Bearer test_token' };

describe('characters CRUD', () => {
  let projectId: string;
  let characterId: string;

  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing. Run pnpm db:seed.');
    const project = await prisma.project.create({
      data: {
        ownerId: user.id,
        name: `角色集成测试-${Date.now()}`,
        ratio: '16:9',
        style: '写实电影感',
        stylePrompt: '写实电影感',
        analysisModel: 'stub',
        imageModel: 'stub',
        videoModel: 'stub',
        characters: {
          create: [
            {
              name: '潘杰',
              description: '测试角色描述',
              bio: '测试角色简介',
              styles: {
                create: [
                  { name: '日常造型', prompt: '日常造型提示词' },
                  { name: '擂台造型', prompt: '擂台造型提示词' },
                  { name: '回忆造型', prompt: '回忆造型提示词' },
                ],
              },
            },
            {
              name: '铁亮',
              description: '测试配角描述',
              bio: '测试配角简介',
            },
          ],
        },
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it('GET /projects/:id/characters returns project-scoped characters', async () => {
    const res = await app.request(`/api/projects/${projectId}/characters`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string; styles: unknown[] }>;
    expect(body.length).toBe(2);
    expect(body.find((c) => c.name === '潘杰')?.styles.length).toBe(3);
  });

  it('POST creates a character', async () => {
    const res = await app.request(`/api/projects/${projectId}/characters`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试角色', description: '测试描述', bio: '测试简介' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.name).toBe('测试角色');
    characterId = body.id;
  });

  it('PATCH updates the character bio', async () => {
    const res = await app.request(`/api/characters/${characterId}`, {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ bio: '更新后的简介' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bio: string };
    expect(body.bio).toBe('更新后的简介');
  });

  it('DELETE removes the character', async () => {
    const res = await app.request(`/api/characters/${characterId}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(res.status).toBe(204);
    const after = await app.request(`/api/characters/${characterId}`, { headers: auth });
    expect(after.status).toBe(404);
    characterId = '';
  });

  it('POST 404s when the project does not belong to user', async () => {
    const res = await app.request('/api/projects/zzznotrealxxxxxxxxxxxxx/characters', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(404);
  });
});
