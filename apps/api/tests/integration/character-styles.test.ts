import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { characterStyleRoutes } from '../../src/routes/character-styles.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';

const SEED_USER_EMAIL = '1280165525@qq.com';
const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', characterStyleRoutes);

const auth = { authorization: 'Bearer test_token' };

describe('character-styles CRUD', () => {
  let characterId: string;
  let styleId: string;

  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing.');
    const char = await prisma.character.findFirst({
      where: { project: { ownerId: user.id }, name: '潘杰' },
    });
    if (!char) throw new Error('Seed character "潘杰" missing.');
    characterId = char.id;
  });

  afterAll(async () => {
    if (styleId) await prisma.characterStyle.deleteMany({ where: { id: styleId } });
    await prisma.$disconnect();
  });

  it('POST adds a style', async () => {
    const res = await app.request(`/api/characters/${characterId}/styles`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试造型' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; image: string };
    expect(body.name).toBe('测试造型');
    expect(body.image).toBe('');
    styleId = body.id;
  });

  it('PATCH renames the style', async () => {
    const res = await app.request(`/api/character-styles/${styleId}`, {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: '测试造型-改' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('测试造型-改');
  });

  it('DELETE removes the style', async () => {
    const res = await app.request(`/api/character-styles/${styleId}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(res.status).toBe(204);
    styleId = '';
  });
});
