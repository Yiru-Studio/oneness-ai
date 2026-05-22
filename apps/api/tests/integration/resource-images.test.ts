import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { resourceImageRoutes } from '../../src/routes/resource-images.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';
import { Buckets } from '../../src/lib/minio.js';

const SEED_USER_EMAIL = '1280165525@qq.com';
const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', resourceImageRoutes);

const auth = { authorization: 'Bearer test_token' };

describe('resource image history', () => {
  let userId = '';
  let projectId = '';
  let itemId = '';
  let assetId = '';
  let secondAssetId = '';
  let resourceImageId = '';
  let secondResourceImageId = '';
  let otherUserId = '';
  let otherProjectId = '';
  let otherItemId = '';

  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing.');
    userId = user.id;
    const project = await prisma.project.findFirst({
      where: { ownerId: user.id, name: '格斗动画' },
    });
    if (!project) throw new Error('Seed project missing.');
    projectId = project.id;

    const item = await prisma.item.create({
      data: { projectId, name: '资源图片测试道具' },
    });
    itemId = item.id;

    const asset = await prisma.asset.create({
      data: {
        ownerId: userId,
        bucket: Buckets.USER_UPLOADS,
        key: `${userId}/tests/resource-image-a.png`,
        contentType: 'image/png',
        sizeBytes: 12,
        width: 1,
        height: 1,
        durationMs: null,
      },
    });
    assetId = asset.id;

    const secondAsset = await prisma.asset.create({
      data: {
        ownerId: userId,
        bucket: Buckets.USER_UPLOADS,
        key: `${userId}/tests/resource-image-b.png`,
        contentType: 'image/png',
        sizeBytes: 12,
        width: 1,
        height: 1,
        durationMs: null,
      },
    });
    secondAssetId = secondAsset.id;

    const other = await prisma.user.create({
      data: {
        email: `resource-image-${Date.now()}@example.com`,
        name: 'Other User',
        credits: 100,
      },
    });
    otherUserId = other.id;
    const otherProject = await prisma.project.create({
      data: {
        ownerId: other.id,
        name: 'Other Project',
        ratio: '16:9',
        style: 'anime',
        stylePrompt: '',
        analysisModel: 'stub',
        imageModel: 'stub',
        videoModel: 'stub',
      },
    });
    otherProjectId = otherProject.id;
    const otherItem = await prisma.item.create({
      data: { projectId: otherProject.id, name: 'Other Item' },
    });
    otherItemId = otherItem.id;
  });

  afterAll(async () => {
    await prisma.resourceImage.deleteMany({
      where: { id: { in: [resourceImageId, secondResourceImageId].filter(Boolean) } },
    });
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    await prisma.asset.deleteMany({
      where: { id: { in: [assetId, secondAssetId].filter(Boolean) } },
    });
    if (otherProjectId) await prisma.project.deleteMany({ where: { id: otherProjectId } });
    if (otherUserId) await prisma.user.deleteMany({ where: { id: otherUserId } });
    await prisma.$disconnect();
  });

  it('creates upload history and sets the current item image', async () => {
    const post = await app.request('/api/resource-images', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'item',
        entityId: itemId,
        source: 'upload',
        assetId,
        prompt: '测试提示词',
        model: 'stub',
        ratio: '1:1',
        setAsCurrent: true,
      }),
    });
    expect(post.status).toBe(201);
    const body = (await post.json()) as { id: string; assetId: string; image: string };
    resourceImageId = body.id;
    expect(body.assetId).toBe(assetId);
    expect(body.image).toContain('resource-image-a.png');

    const item = await prisma.item.findUnique({ where: { id: itemId } });
    expect(item?.assetId).toBe(assetId);

    const list = await app.request(`/api/resource-images?kind=item&entityId=${itemId}`, {
      headers: auth,
    });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as Array<{ id: string }>;
    expect(rows.some((row) => row.id === resourceImageId)).toBe(true);
  });

  it('sets a previous history image as current via PATCH', async () => {
    const created = await prisma.resourceImage.create({
      data: {
        ownerId: userId,
        projectId,
        kind: 'item',
        source: 'upload',
        status: 'SUCCEEDED',
        assetId: secondAssetId,
        itemId,
      },
    });
    secondResourceImageId = created.id;

    const patch = await app.request(`/api/resource-images/${secondResourceImageId}`, {
      method: 'PATCH',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ setAsCurrent: true }),
    });
    expect(patch.status).toBe(200);
    const item = await prisma.item.findUnique({ where: { id: itemId } });
    expect(item?.assetId).toBe(secondAssetId);
  });

  it('rejects resources owned by another user', async () => {
    const res = await app.request(`/api/resource-images?kind=item&entityId=${otherItemId}`, {
      headers: auth,
    });
    expect(res.status).toBe(404);
  });
});
