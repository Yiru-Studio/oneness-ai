import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Worker } from 'bullmq';
import { taskRoutes } from '../../src/routes/tasks.js';
import { compositionTaskRoutes } from '../../src/routes/composition-tasks.js';
import { imageGenerationRunRoutes } from '../../src/routes/image-generation-runs.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { prisma } from '../../src/lib/prisma.js';
import { config } from '../../src/config.js';
import { processTask } from '../../../worker/src/processor.js';
import { QueueNames, WorkerConcurrency } from '@oneness/shared/queues';
import { TaskStatus, TaskType } from '@oneness/shared/enums';

const SEED_USER_EMAIL = '1280165525@qq.com';

const app = new Hono();
app.use('*', requestIdMiddleware);
app.onError(errorHandler);
app.route('/api', taskRoutes);
app.route('/api', compositionTaskRoutes);
app.route('/api', imageGenerationRunRoutes);

const auth = { authorization: 'Bearer test_token' };
const connection = { url: config.REDIS_URL };

let workers: Worker[] = [];

async function pollUntilTerminal(taskId: string, timeoutMs = 15000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true },
    });
    if (
      t &&
      [TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(
        t.status as TaskStatus,
      )
    ) {
      return t.status;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`task ${taskId} did not reach terminal state within ${timeoutMs}ms`);
}

async function pollCreditsAtLeast(
  email: string,
  minimumCredits: number,
  timeoutMs = 5000,
): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { credits: true },
    });
    if ((user?.credits ?? 0) >= minimumCredits) return user!.credits;
    await new Promise((r) => setTimeout(r, 200));
  }
  const user = await prisma.user.findUnique({
    where: { email },
    select: { credits: true },
  });
  return user?.credits ?? 0;
}

async function createQueuedTextTask(
  ownerId: string,
  projectId: string,
  input: Record<string, unknown>,
) {
  return prisma.task.create({
    data: {
      ownerId,
      projectId,
      type: TaskType.TEXT_ANALYZE,
      provider: 'stub',
      status: TaskStatus.QUEUED,
      costCredits: 0,
      input,
    },
  });
}

async function styleNamesForIds(ids: string[]): Promise<string[]> {
  const rows = await prisma.characterStyle.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, character: { select: { name: true } } },
  });
  const byId = new Map(rows.map((row) => [row.id, `${row.character.name} · ${row.name}`]));
  return ids.map((id) => byId.get(id)).filter((name): name is string => Boolean(name));
}

describe('tasks lifecycle', () => {
  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing.');
    // Force STUB_FAIL_RATE=0 for predictable success tests; failure test toggles it.
    process.env.STUB_FAIL_RATE = '0';
    // Start a Worker for each queue, in-process.
    workers = [
      new Worker(QueueNames.IMAGE, async (job) => processTask(job.data.taskId), {
        connection,
        concurrency: WorkerConcurrency[QueueNames.IMAGE],
      }),
      new Worker(QueueNames.VIDEO, async (job) => processTask(job.data.taskId), {
        connection,
        concurrency: WorkerConcurrency[QueueNames.VIDEO],
      }),
      new Worker(QueueNames.TEXT, async (job) => processTask(job.data.taskId), {
        connection,
        concurrency: WorkerConcurrency[QueueNames.TEXT],
      }),
    ];
  });

  afterAll(async () => {
    await Promise.all(workers.map((w) => w.close()));
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Reset credits to a known floor so each test can reason about deltas.
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (user && user.credits < 100) {
      await prisma.user.update({
        where: { id: user.id },
        data: { credits: 10158 },
      });
    }
  });

  it('IMAGE task completes successfully with output asset', async () => {
    const before = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { credits: true },
    });
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'IMAGE',
        provider: 'stub',
        input: { prompt: 'red square', ratio: '1:1', model: 'stub', n: 1 },
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; status: string; costCredits: number };
    expect(created.status).toBe('QUEUED');
    expect(created.costCredits).toBe(1);

    const after = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { credits: true },
    });
    expect(after?.credits).toBe((before?.credits ?? 0) - 1);

    const final = await pollUntilTerminal(created.id);
    expect(final).toBe('SUCCEEDED');

    const fullRes = await app.request(`/api/tasks/${created.id}`, { headers: auth });
    const body = (await fullRes.json()) as {
      outputAssets: Array<{ id: string; url: string }>;
      status: string;
    };
    expect(body.status).toBe('SUCCEEDED');
    expect(body.outputAssets.length).toBe(1);
    expect(body.outputAssets[0].url).toContain('task-outputs');
  });

  it('shot sketch IMAGE task links output back to Shot.sketchAssetId', async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.findFirst({ where: { ownerId: user.id } });
    if (!project) throw new Error('Seed project missing.');
    const episode = await prisma.storyboardEpisode.findFirst({ where: { projectId: project.id } });
    if (!episode) throw new Error('Seed episode missing.');
    const maxShot = await prisma.shot.findFirst({
      where: { episodeId: episode.id },
      orderBy: { displayId: 'desc' },
      select: { displayId: true },
    });
    const shot = await prisma.shot.create({
      data: {
        episodeId: episode.id,
        displayId: (maxShot?.displayId ?? 0) + 1,
        sceneIndex: 0,
        prompt: '测试合成镜头参考图',
        ratio: project.ratio,
        model: project.videoModel,
        createType: 'assist',
      },
    });
    const task = await prisma.task.create({
      data: {
        ownerId: user.id,
        projectId: project.id,
        type: TaskType.IMAGE,
        provider: 'stub',
        status: TaskStatus.QUEUED,
        costCredits: 0,
        input: {
          prompt: 'blue cinematic storyboard frame',
          ratio: project.ratio,
          model: 'stub',
          n: 1,
          shotSketch: true,
          shotId: shot.id,
        },
      },
    });
    await prisma.shot.update({ where: { id: shot.id }, data: { sketchTaskId: task.id } });
    const run = await prisma.shotSketchRun.create({
      data: {
        projectId: project.id,
        episodeId: episode.id,
        shotId: shot.id,
        source: 'generated',
        prompt: 'blue cinematic storyboard frame',
        model: 'stub',
        ratio: project.ratio,
        referenceAssetIds: [],
        params: {},
        status: TaskStatus.QUEUED,
        taskJobId: task.id,
      },
    });

    await processTask(task.id);

    const linked = await prisma.shot.findUnique({
      where: { id: shot.id },
      select: { sketchTaskId: true, sketchAssetId: true, sketch: { select: { contentType: true } } },
    });
    const linkedRun = await prisma.shotSketchRun.findUnique({
      where: { id: run.id },
      select: { status: true, error: true, outputAssetId: true },
    });
    expect(linked?.sketchTaskId).toBe(task.id);
    expect(linked?.sketchAssetId).toBeTruthy();
    expect(linked?.sketch?.contentType).toBe('image/png');
    expect(linkedRun?.status).toBe(TaskStatus.SUCCEEDED);
    expect(linkedRun?.error).toBeNull();
    expect(linkedRun?.outputAssetId).toBe(linked?.sketchAssetId);

    await prisma.shot.delete({ where: { id: shot.id } });
  });

  it('character-style IMAGE task injects the identity reference first', async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.findFirst({ where: { ownerId: user.id } });
    if (!project) throw new Error('Seed project missing.');

    const identityAsset = await prisma.asset.create({
      data: {
        ownerId: user.id,
        bucket: 'test-fixtures',
        key: `identity-${Date.now()}-${Math.random()}.png`,
        contentType: 'image/png',
        sizeBytes: 10,
      },
    });
    const extraAsset = await prisma.asset.create({
      data: {
        ownerId: user.id,
        bucket: 'test-fixtures',
        key: `extra-${Date.now()}-${Math.random()}.png`,
        contentType: 'image/png',
        sizeBytes: 10,
      },
    });
    const character = await prisma.character.create({
      data: {
        projectId: project.id,
        name: '身份参考测试角色',
        description: '',
        bio: '',
        identityAssetId: identityAsset.id,
      },
    });
    const style = await prisma.characterStyle.create({
      data: {
        characterId: character.id,
        name: '身份参考测试造型',
        prompt: '',
        model: 'stub',
        ratio: '1:1',
      },
    });

    process.env.STUB_FAIL_RATE = '0';
    try {
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'IMAGE',
          projectId: project.id,
          provider: 'stub',
          input: {
            prompt: 'same person in a blue coat',
            ratio: '1:1',
            model: 'stub',
            referenceAssetIds: [extraAsset.id],
            n: 1,
          },
          resourceTarget: { kind: 'character-style', entityId: style.id },
        }),
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { id: string };

      const queued = await prisma.task.findUnique({
        where: { id: created.id },
        select: { input: true },
      });
      const input = queued?.input as {
        identityReferenceAssetId?: string;
        referenceAssetIds?: string[];
      };
      expect(input.identityReferenceAssetId).toBe(identityAsset.id);
      expect(input.referenceAssetIds).toEqual([identityAsset.id, extraAsset.id]);

      const final = await pollUntilTerminal(created.id);
      expect(final).toBe(TaskStatus.SUCCEEDED);
      const completed = await prisma.task.findUnique({
        where: { id: created.id },
        select: { output: true },
      });
      const output = completed?.output as {
        mode?: string;
        identityReferenceAssetId?: string | null;
        referenceAssetIds?: string[];
      };
      expect(output.mode).toBe('edit');
      expect(output.identityReferenceAssetId).toBe(identityAsset.id);
      expect(output.referenceAssetIds).toEqual([identityAsset.id, extraAsset.id]);
    } finally {
      process.env.STUB_FAIL_RATE = '0';
      await prisma.character.deleteMany({ where: { id: character.id } });
      await prisma.asset.deleteMany({ where: { id: { in: [identityAsset.id, extraAsset.id] } } });
    }
  });

  it('character-style IMAGE task can seed identity from any first generated style', async () => {
    const user = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { id: true, credits: true },
    });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.findFirst({ where: { ownerId: user.id } });
    if (!project) throw new Error('Seed project missing.');

    const character = await prisma.character.create({
      data: {
        projectId: project.id,
        name: '缺少身份参考测试角色',
        description: '',
        bio: '',
      },
    });
    const style = await prisma.characterStyle.create({
      data: {
        characterId: character.id,
        name: '缺少身份参考测试造型',
        prompt: '',
        model: 'stub',
        ratio: '1:1',
      },
    });

    let taskId: string | null = null;
    try {
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'IMAGE',
          projectId: project.id,
          provider: 'stub',
          input: {
            prompt: 'same person in a blue coat',
            ratio: '1:1',
            model: 'stub',
            n: 1,
          },
          resourceTarget: { kind: 'character-style', entityId: style.id },
        }),
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { id: string };
      taskId = created.id;
      const final = await pollUntilTerminal(created.id);
      expect(final).toBe(TaskStatus.SUCCEEDED);
      const [fresh, freshStyle] = await Promise.all([
        prisma.character.findUnique({
          where: { id: character.id },
          select: { avatarAssetId: true, identityAssetId: true },
        }),
        prisma.characterStyle.findUnique({
          where: { id: style.id },
          select: { assetId: true },
        }),
      ]);
      expect(freshStyle?.assetId).toBeTruthy();
      expect(fresh?.identityAssetId).toBe(freshStyle?.assetId);
      expect(fresh?.avatarAssetId).toBe(freshStyle?.assetId);
    } finally {
      await prisma.user.update({
        where: { id: user.id },
        data: { credits: user.credits },
      });
      await prisma.character.deleteMany({ where: { id: character.id } });
      if (taskId) await prisma.task.deleteMany({ where: { id: taskId } });
    }
  });

  it('default character-style IMAGE task can generate the first identity master', async () => {
    const user = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { id: true, credits: true },
    });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.findFirst({ where: { ownerId: user.id } });
    if (!project) throw new Error('Seed project missing.');

    const character = await prisma.character.create({
      data: {
        projectId: project.id,
        name: '默认造型身份母版测试角色',
        description: '',
        bio: '',
      },
    });
    const style = await prisma.characterStyle.create({
      data: {
        characterId: character.id,
        name: '默认造型',
        prompt: '纯角色参考图，全身站姿。',
        model: 'stub',
        ratio: '1:1',
      },
    });

    process.env.STUB_FAIL_RATE = '0';
    let taskId: string | null = null;
    try {
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'IMAGE',
          projectId: project.id,
          provider: 'stub',
          input: {
            prompt: '纯角色参考图，全身站姿。',
            ratio: '1:1',
            model: 'stub',
            n: 1,
          },
          resourceTarget: { kind: 'character-style', entityId: style.id },
        }),
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { id: string };
      taskId = created.id;
      const queued = await prisma.task.findUnique({
        where: { id: created.id },
        select: { input: true },
      });
      const input = queued?.input as {
        identityReferenceAssetId?: string | null;
        referenceAssetIds?: string[];
      };
      expect(input.identityReferenceAssetId).toBeUndefined();
      expect(input.referenceAssetIds).toBeUndefined();

      const final = await pollUntilTerminal(created.id);
      expect(final).toBe(TaskStatus.SUCCEEDED);
      const fresh = await prisma.character.findUnique({
        where: { id: character.id },
        select: { avatarAssetId: true, identityAssetId: true },
      });
      const freshStyle = await prisma.characterStyle.findUnique({
        where: { id: style.id },
        select: { assetId: true },
      });
      expect(freshStyle?.assetId).toBeTruthy();
      expect(fresh?.identityAssetId).toBe(freshStyle?.assetId);
      expect(fresh?.avatarAssetId).toBe(freshStyle?.assetId);
    } finally {
      process.env.STUB_FAIL_RATE = '0';
      await prisma.user.update({
        where: { id: user.id },
        data: { credits: user.credits },
      });
      await prisma.character.deleteMany({ where: { id: character.id } });
      if (taskId) await prisma.task.deleteMany({ where: { id: taskId } });
    }
  });

  it('character-avatar IMAGE task persists status and fills avatar identity on success', async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.findFirst({ where: { ownerId: user.id } });
    if (!project) throw new Error('Seed project missing.');
    const character = await prisma.character.create({
      data: {
        projectId: project.id,
        name: '头像持久任务测试角色',
        description: '',
        bio: '',
      },
    });

    try {
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'IMAGE',
          projectId: project.id,
          provider: 'stub',
          input: {
            prompt: '头像持久任务测试角色的半身头像',
            ratio: '1:1',
            model: 'stub',
            n: 1,
            characterId: character.id,
          },
          resourceTarget: { kind: 'character-avatar', entityId: character.id },
        }),
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { id: string };
      const queued = await prisma.resourceImage.findFirst({
        where: { taskId: created.id, kind: 'character-avatar', characterId: character.id },
        select: { status: true },
      });
      expect(queued?.status).toBe(TaskStatus.QUEUED);

      const final = await pollUntilTerminal(created.id);
      expect(final).toBe(TaskStatus.SUCCEEDED);

      const fresh = await prisma.character.findUnique({
        where: { id: character.id },
        select: { avatarAssetId: true, identityAssetId: true },
      });
      expect(fresh?.avatarAssetId).toBeTruthy();
      expect(fresh?.identityAssetId).toBe(fresh?.avatarAssetId);

      const row = await prisma.resourceImage.findFirst({
        where: { taskId: created.id },
        select: { status: true, assetId: true, characterId: true },
      });
      expect(row?.status).toBe(TaskStatus.SUCCEEDED);
      expect(row?.assetId).toBe(fresh?.avatarAssetId);
      expect(row?.characterId).toBe(character.id);
    } finally {
      await prisma.character.deleteMany({ where: { id: character.id } });
    }
  });

  it('reuses an active resource image task for the same target instead of charging twice', async () => {
    const user = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { id: true, credits: true },
    });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.findFirst({ where: { ownerId: user.id } });
    if (!project) throw new Error('Seed project missing.');
    const scene = await prisma.scene.create({
      data: {
        projectId: project.id,
        name: '重复生成复用测试场景',
        description: '',
        prompt: '',
      },
    });
    const existingTask = await prisma.task.create({
      data: {
        ownerId: user.id,
        projectId: project.id,
        type: TaskType.IMAGE,
        provider: 'stub',
        status: TaskStatus.QUEUED,
        costCredits: 1,
        input: { prompt: '已存在的场景图生成任务', ratio: '16:9', model: 'stub', n: 1 },
      },
    });
    await prisma.resourceImage.create({
      data: {
        ownerId: user.id,
        projectId: project.id,
        kind: 'scene',
        source: 'generated',
        status: TaskStatus.QUEUED,
        prompt: '已存在的场景图生成任务',
        model: 'stub',
        ratio: '16:9',
        taskId: existingTask.id,
        sceneId: scene.id,
      },
    });

    try {
      const before = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { credits: true },
      });
      const beforeTaskCount = await prisma.task.count({
        where: { ownerId: user.id, projectId: project.id, type: TaskType.IMAGE },
      });
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'IMAGE',
          projectId: project.id,
          provider: 'stub',
          input: {
            prompt: '第二次点击同一个场景生成',
            ratio: '16:9',
            model: 'stub',
            n: 1,
          },
          resourceTarget: { kind: 'scene', entityId: scene.id },
        }),
      });
      expect(res.status).toBe(202);
      const reused = (await res.json()) as { id: string };
      expect(reused.id).toBe(existingTask.id);
      const [after, taskCount, resourceCount] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { credits: true } }),
        prisma.task.count({ where: { ownerId: user.id, projectId: project.id, type: TaskType.IMAGE } }),
        prisma.resourceImage.count({ where: { ownerId: user.id, projectId: project.id, kind: 'scene', sceneId: scene.id } }),
      ]);
      expect(after.credits).toBe(before.credits);
      expect(taskCount).toBe(beforeTaskCount);
      expect(resourceCount).toBe(1);
    } finally {
      await prisma.task.deleteMany({ where: { id: existingTask.id } });
      await prisma.scene.deleteMany({ where: { id: scene.id } });
      await prisma.user.update({ where: { id: user.id }, data: { credits: user.credits } });
    }
  });

  it('lists image generation runs from resource, composition, and shot sketch records', async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL }, select: { id: true } });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.create({
      data: {
        ownerId: user.id,
        name: `统一图片运行态测试-${Date.now()}`,
        ratio: '16:9',
        style: '写实',
        stylePrompt: '写实',
        analysisModel: 'stub-text-chain',
        imageModel: 'stub',
        videoModel: 'stub',
      },
    });
    const episode = await prisma.storyboardEpisode.create({
      data: { projectId: project.id, number: 1, title: '测试集', content: '测试内容' },
    });
    const scene = await prisma.scene.create({
      data: { projectId: project.id, name: '统一运行态场景', description: '', prompt: '' },
    });
    const imageTask = await prisma.task.create({
      data: {
        ownerId: user.id,
        projectId: project.id,
        type: TaskType.IMAGE,
        provider: 'stub',
        status: TaskStatus.QUEUED,
        input: { prompt: '场景', ratio: '16:9', model: 'stub', n: 1 },
      },
    });
    const composition = await prisma.compositionTask.create({
      data: {
        projectId: project.id,
        episodeId: episode.id,
        sceneIndex: 0,
        title: '第1集 · 统一运行态场景',
        scriptExcerpt: '测试内容',
        prompt: '场景图 prompt',
      },
    });
    const shot = await prisma.shot.create({
      data: {
        episodeId: episode.id,
        displayId: 1,
        sceneIndex: 0,
        prompt: '主分镜 prompt',
        model: 'stub',
        ratio: '16:9',
      },
    });
    await prisma.resourceImage.create({
      data: {
        ownerId: user.id,
        projectId: project.id,
        kind: 'scene',
        source: 'generated',
        status: TaskStatus.QUEUED,
        taskId: imageTask.id,
        sceneId: scene.id,
      },
    });
    await prisma.compositionImageRun.create({
      data: {
        taskId: composition.id,
        prompt: '场景图 prompt',
        model: 'stub',
        ratio: '16:9',
        status: TaskStatus.QUEUED,
        taskJobId: imageTask.id,
      },
    });
    await prisma.shotSketchRun.create({
      data: {
        projectId: project.id,
        episodeId: episode.id,
        shotId: shot.id,
        source: 'generated',
        prompt: '主分镜 prompt',
        model: 'stub',
        ratio: '16:9',
        status: TaskStatus.QUEUED,
        taskJobId: imageTask.id,
      },
    });

    try {
      const res = await app.request(`/api/image-generation-runs?projectId=${project.id}&activeOnly=true`, {
        headers: auth,
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Array<{ kind: string; status: string; ownerEntityId: string | null }>;
      expect(body).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'resource', status: TaskStatus.QUEUED, ownerEntityId: scene.id }),
        expect.objectContaining({ kind: 'composition-image', status: TaskStatus.QUEUED, ownerEntityId: composition.id }),
        expect.objectContaining({ kind: 'shot-sketch', status: TaskStatus.QUEUED, ownerEntityId: shot.id }),
      ]));
    } finally {
      await prisma.task.deleteMany({ where: { id: imageTask.id } });
      await prisma.project.deleteMany({ where: { id: project.id } });
    }
  });

  it('reuses an active composition image run instead of creating another image task', async () => {
    const user = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { id: true, credits: true },
    });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.create({
      data: {
        ownerId: user.id,
        name: `场景图复用测试-${Date.now()}`,
        ratio: '16:9',
        style: '写实',
        stylePrompt: '写实',
        analysisModel: 'stub-text-chain',
        imageModel: 'stub',
        videoModel: 'stub',
      },
    });
    const episode = await prisma.storyboardEpisode.create({
      data: { projectId: project.id, number: 1, title: '测试集', content: '测试内容' },
    });
    const composition = await prisma.compositionTask.create({
      data: {
        projectId: project.id,
        episodeId: episode.id,
        sceneIndex: 0,
        title: '第1集 · 场景图复用',
        scriptExcerpt: '测试内容',
        prompt: '场景图 prompt',
      },
    });
    const task = await prisma.task.create({
      data: {
        ownerId: user.id,
        projectId: project.id,
        type: TaskType.IMAGE,
        provider: 'stub',
        status: TaskStatus.QUEUED,
        input: { prompt: '场景图 prompt', ratio: '16:9', model: 'stub', n: 1 },
      },
    });
    const run = await prisma.compositionImageRun.create({
      data: {
        taskId: composition.id,
        prompt: '场景图 prompt',
        model: 'stub',
        ratio: '16:9',
        status: TaskStatus.QUEUED,
        taskJobId: task.id,
      },
    });
    await prisma.compositionTask.update({
      where: { id: composition.id },
      data: { currentImageRunId: run.id, imageTaskId: task.id, status: 'IMAGE_QUEUED' },
    });

    try {
      const before = await prisma.task.count({ where: { projectId: project.id, type: TaskType.IMAGE } });
      const res = await app.request(`/api/composition-tasks/${composition.id}/generate-image`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'stub', ratio: '16:9' }),
      });
      expect(res.status).toBe(200);
      const after = await prisma.task.count({ where: { projectId: project.id, type: TaskType.IMAGE } });
      expect(after).toBe(before);
    } finally {
      await prisma.task.deleteMany({ where: { id: task.id } });
      await prisma.project.deleteMany({ where: { id: project.id } });
      await prisma.user.update({ where: { id: user.id }, data: { credits: user.credits } });
    }
  });

  it('transient OpenAI IMAGE error policy marks the failure retryable', async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.findFirst({ where: { ownerId: user.id } });
    if (!project) throw new Error('Seed project missing.');
    const scene = await prisma.scene.create({
      data: {
        projectId: project.id,
        name: 'Retry 状态同步测试场景',
        description: '',
        prompt: '',
      },
    });
    const task = await prisma.task.create({
      data: {
        ownerId: user.id,
        projectId: project.id,
        type: TaskType.IMAGE,
        provider: 'stub',
        status: TaskStatus.QUEUED,
        costCredits: 0,
        input: { prompt: '[test-openai-429] transient', ratio: '1:1', model: 'stub', n: 1 },
      },
    });
    await prisma.resourceImage.create({
      data: {
        ownerId: user.id,
        projectId: project.id,
        kind: 'scene',
        source: 'generated',
        status: TaskStatus.QUEUED,
        prompt: '[test-openai-429] transient',
        taskId: task.id,
        sceneId: scene.id,
      },
    });

    try {
      await processTask(task.id, { attemptsMade: 0, attempts: 1 });
      const fresh = await prisma.task.findUnique({
        where: { id: task.id },
        select: {
          status: true,
          error: true,
          completedAt: true,
          retryCount: true,
          nextRetryAt: true,
          retryUntil: true,
        },
      });
      expect(fresh?.status).toBe(TaskStatus.RETRYING);
      expect(fresh?.error).toContain('http_429');
      expect(fresh?.completedAt).toBeNull();
      expect(fresh?.retryCount).toBe(1);
      expect(fresh?.nextRetryAt).toBeInstanceOf(Date);
      expect(fresh?.retryUntil).toBeInstanceOf(Date);
      const image = await prisma.resourceImage.findFirst({
        where: { taskId: task.id },
        select: { status: true, error: true },
      });
      expect(image?.status).toBe(TaskStatus.RETRYING);
      expect(image?.error).toContain('http_429');
    } finally {
      await prisma.task.deleteMany({ where: { id: task.id } });
      await prisma.scene.deleteMany({ where: { id: scene.id } });
    }
  });

  it('OpenAI timeout marks IMAGE task retrying without extra credit charge', async () => {
    const user = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { id: true, credits: true },
    });
    if (!user) throw new Error('Seed user missing.');
    const task = await prisma.task.create({
      data: {
        ownerId: user.id,
        type: TaskType.IMAGE,
        provider: 'stub',
        status: TaskStatus.QUEUED,
        costCredits: 1,
        input: { prompt: '[test-openai-timeout]', ratio: '1:1', model: 'stub', n: 1 },
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { credits: { decrement: task.costCredits } },
    });
    try {
      await processTask(task.id);
      const fresh = await prisma.task.findUnique({
        where: { id: task.id },
        select: { status: true, error: true, retryCount: true },
      });
      expect(fresh?.status).toBe(TaskStatus.RETRYING);
      expect(fresh?.error).toContain('timeout');
      expect(fresh?.retryCount).toBe(1);
      const after = await prisma.user.findUnique({
        where: { id: user.id },
        select: { credits: true },
      });
      expect(after?.credits).toBe(user.credits - task.costCredits);
    } finally {
      await prisma.user.update({
        where: { id: user.id },
        data: { credits: user.credits },
      });
      await prisma.task.deleteMany({ where: { id: task.id } });
    }
  });

  it('terminal OpenAI IMAGE error fails and refunds credits', async () => {
    const user = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { id: true, credits: true },
    });
    if (!user) throw new Error('Seed user missing.');
    const task = await prisma.task.create({
      data: {
        ownerId: user.id,
        type: TaskType.IMAGE,
        provider: 'stub',
        status: TaskStatus.QUEUED,
        costCredits: 1,
        input: { prompt: '[test-openai-invalid]', ratio: '1:1', model: 'stub', n: 1 },
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { credits: { decrement: task.costCredits } },
    });
    try {
      await expect(processTask(task.id)).rejects.toThrow('invalid_params');
      const fresh = await prisma.task.findUnique({
        where: { id: task.id },
        select: { status: true, retryCount: true, nextRetryAt: true },
      });
      expect(fresh?.status).toBe(TaskStatus.FAILED);
      expect(fresh?.retryCount).toBe(0);
      expect(fresh?.nextRetryAt).toBeNull();
      const after = await prisma.user.findUnique({
        where: { id: user.id },
        select: { credits: true },
      });
      expect(after?.credits).toBe(user.credits);
    } finally {
      await prisma.user.update({
        where: { id: user.id },
        data: { credits: user.credits },
      });
      await prisma.task.deleteMany({ where: { id: task.id } });
    }
  });

  it('delayed retry metadata lets current retry run and skips stale retry jobs', async () => {
    const user = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { id: true, credits: true },
    });
    if (!user) throw new Error('Seed user missing.');
    const task = await prisma.task.create({
      data: {
        ownerId: user.id,
        type: TaskType.IMAGE,
        provider: 'stub',
        status: TaskStatus.QUEUED,
        costCredits: 1,
        input: { prompt: '[test-openai-429] first', ratio: '1:1', model: 'stub', n: 1 },
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { credits: { decrement: task.costCredits } },
    });
    try {
      await processTask(task.id);
      const retrying = await prisma.task.findUnique({
        where: { id: task.id },
        select: { retryCount: true, nextRetryAt: true, status: true },
      });
      expect(retrying?.status).toBe(TaskStatus.RETRYING);
      expect(retrying?.retryCount).toBe(1);
      expect(retrying?.nextRetryAt).toBeInstanceOf(Date);

      const dueNextRetryAt = new Date(Date.now() - 1000);
      await prisma.task.update({
        where: { id: task.id },
        data: {
          input: { prompt: 'retry succeeds', ratio: '1:1', model: 'stub', n: 1 },
          nextRetryAt: dueNextRetryAt,
        },
      });
      await processTask(task.id, {
        retryCount: retrying!.retryCount,
        nextRetryAt: dueNextRetryAt.toISOString(),
      });
      const succeeded = await prisma.task.findUnique({
        where: { id: task.id },
        select: { status: true, retryCount: true },
      });
      expect(succeeded?.status).toBe(TaskStatus.SUCCEEDED);
      expect(succeeded?.retryCount).toBe(0);

      await prisma.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.RETRYING,
          retryCount: 2,
          nextRetryAt: new Date(Date.now() - 1000),
          retryUntil: new Date(Date.now() + 60_000),
        },
      });
      await processTask(task.id, {
        retryCount: 1,
        nextRetryAt: retrying!.nextRetryAt!.toISOString(),
      });
      const afterStaleJob = await prisma.task.findUnique({
        where: { id: task.id },
        select: { status: true, retryCount: true },
      });
      expect(afterStaleJob?.status).toBe(TaskStatus.RETRYING);
      expect(afterStaleJob?.retryCount).toBe(2);

      const after = await prisma.user.findUnique({
        where: { id: user.id },
        select: { credits: true },
      });
      expect(after?.credits).toBe(user.credits - task.costCredits);
    } finally {
      await prisma.user.update({
        where: { id: user.id },
        data: { credits: user.credits },
      });
      await prisma.task.deleteMany({ where: { id: task.id } });
    }
  });

  it('manual retry does not deduct credits again', async () => {
    const user = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { id: true, credits: true },
    });
    if (!user) throw new Error('Seed user missing.');
    const task = await prisma.task.create({
      data: {
        ownerId: user.id,
        type: TaskType.IMAGE,
        provider: 'stub',
        status: TaskStatus.RETRYING,
        costCredits: 1,
        retryCount: 3,
        nextRetryAt: null,
        retryUntil: new Date(Date.now() - 1000),
        input: { prompt: 'manual retry', ratio: '1:1', model: 'stub', n: 1 },
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { credits: { decrement: task.costCredits } },
    });
    try {
      const beforeRetry = await prisma.user.findUnique({
        where: { id: user.id },
        select: { credits: true },
      });
      const res = await app.request(`/api/tasks/${task.id}/retry`, {
        method: 'POST',
        headers: auth,
      });
      expect(res.status).toBe(200);
      const afterRetry = await prisma.user.findUnique({
        where: { id: user.id },
        select: { credits: true },
      });
      expect(afterRetry?.credits).toBe(beforeRetry?.credits);
    } finally {
      await prisma.user.update({
        where: { id: user.id },
        data: { credits: user.credits },
      });
      await prisma.task.deleteMany({ where: { id: task.id } });
    }
  });

  it('TEXT task completes', async () => {
    // Need a project (TextInput requires projectId)
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
    const project = await prisma.project.findFirst({ where: { ownerId: user!.id } });
    if (!project) throw new Error('Seed project missing.');
    const episode = await prisma.storyboardEpisode.findFirst({
      where: { projectId: project.id },
    });
    if (!episode) throw new Error('Seed episode missing.');

    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'TEXT_ANALYZE',
        projectId: project.id,
        provider: 'stub',
        input: { episodeId: episode.id, analysisType: 'general' },
      }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const final = await pollUntilTerminal(id, 8000);
    expect(final).toBe('SUCCEEDED');

    const final2 = await app.request(`/api/tasks/${id}`, { headers: auth });
    const body = (await final2.json()) as { output: { kind: string; summary: string } };
    expect(body.output.kind).toBe('stub-text');
    expect(body.output.summary.length).toBeGreaterThan(10);
  });

  it('characters extraction enqueues zero-credit character_detail tasks', async () => {
    const user = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { id: true },
    });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.findFirst({ where: { ownerId: user.id } });
    if (!project) throw new Error('Seed project missing.');
    const episode = await prisma.storyboardEpisode.findFirst({ where: { projectId: project.id } });
    if (!episode) throw new Error('Seed episode missing.');

    const task = await prisma.task.create({
      data: {
        ownerId: user.id,
        projectId: project.id,
        type: TaskType.TEXT_ANALYZE,
        provider: 'stub',
        status: TaskStatus.QUEUED,
        costCredits: 0,
        input: { episodeId: episode.id, subjectType: 'characters', model: 'stub' },
      },
    });

    await processTask(task.id, { attemptsMade: 0, attempts: 1 });

    const parent = await prisma.task.findUnique({
      where: { id: task.id },
      select: { status: true, output: true },
    });
    expect(parent?.status).toBe(TaskStatus.SUCCEEDED);
    const createdIds = ((parent?.output as { createdIds?: string[] } | null)?.createdIds ?? []);
    expect(createdIds.length).toBeGreaterThan(0);

    const allDetailTasks = await prisma.task.findMany({
      where: {
        projectId: project.id,
        type: TaskType.TEXT_ANALYZE,
        input: { path: ['analysisType'], equals: 'character_detail' },
      },
      select: { id: true, costCredits: true, input: true, status: true },
    });
    const detailTasks = allDetailTasks.filter((row) =>
      createdIds.includes((row.input as { characterId?: string }).characterId ?? ''),
    );
    const createdDetailIds = new Set(
      detailTasks.map((row) => (row.input as { characterId?: string }).characterId),
    );
    expect(createdIds.every((id) => createdDetailIds.has(id))).toBe(true);
    expect(detailTasks.every((row) => row.costCredits === 0)).toBe(true);
    expect(
      detailTasks.every((row) =>
        [TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.SUCCEEDED].includes(row.status),
      ),
    ).toBe(true);

    await Promise.all(
      detailTasks.map((row) => pollUntilTerminal(row.id, 5000).catch(() => row.status)),
    );

    await prisma.task.deleteMany({
      where: {
        OR: [
          { id: task.id },
          { id: { in: detailTasks.map((row) => row.id) } },
        ],
      },
    });
    await prisma.character.deleteMany({ where: { id: { in: createdIds } } });
  });

  it('character_detail task creates reusable CharacterStyle records without charging credits', async () => {
    const user = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { id: true, credits: true },
    });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.findFirst({ where: { ownerId: user.id } });
    if (!project) throw new Error('Seed project missing.');
    const episode = await prisma.storyboardEpisode.findFirst({ where: { projectId: project.id } });
    if (!episode) throw new Error('Seed episode missing.');
    const character = await prisma.character.create({
      data: {
        projectId: project.id,
        name: '司机',
        description: '中年网约车司机',
        bio: '',
      },
    });
    const task = await prisma.task.create({
      data: {
        ownerId: user.id,
        projectId: project.id,
        type: TaskType.TEXT_ANALYZE,
        provider: 'stub',
        status: TaskStatus.QUEUED,
        costCredits: 0,
        input: {
          episodeId: episode.id,
          characterId: character.id,
          analysisType: 'character_detail',
          model: 'stub',
        },
      },
    });

    try {
      await processTask(task.id);
      const fresh = await prisma.character.findUnique({
        where: { id: character.id },
        include: { styles: { orderBy: { createdAt: 'asc' } } },
      });
      expect(fresh?.avatarPrompt).toContain('头像');
      expect(fresh?.styles).toHaveLength(2);
      expect(fresh?.styles.every((style) => style.assetId === null)).toBe(true);
      expect(fresh?.styles.every((style) => style.model === project.imageModel)).toBe(true);
      const after = await prisma.user.findUnique({
        where: { id: user.id },
        select: { credits: true },
      });
      expect(after?.credits).toBe(user.credits);
    } finally {
      await prisma.task.deleteMany({ where: { id: task.id } });
      await prisma.character.deleteMany({ where: { id: character.id } });
    }
  });

  it('pure text chain persists scene reference visibility and style-aware refs through composition and shots', async () => {
    const user = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { id: true },
    });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.create({
      data: {
        ownerId: user.id,
        name: `纯文本链路集成测试-${Date.now()}`,
        ratio: '16:9',
        style: '写实电影感',
        stylePrompt: '写实电影感，雨夜车内压抑氛围',
        analysisModel: 'stub-text-chain',
        imageModel: 'stub',
        videoModel: 'stub',
      },
    });
    const episode = await prisma.storyboardEpisode.create({
      data: {
        projectId: project.id,
        number: 1,
        title: '雨夜网约车',
        content: '雨夜，我坐进网约车后座，司机透过后视镜观察我。电话里的中年女声提到池清明和篮球。',
      },
    });

    try {
      const sceneTask = await createQueuedTextTask(user.id, project.id, {
        episodeId: episode.id,
        analysisType: 'scene_list',
        model: 'stub-text-chain',
      });
      await processTask(sceneTask.id);

      const analyzedEpisode = await prisma.storyboardEpisode.findUniqueOrThrow({
        where: { id: episode.id },
        select: { analyzed: true, scenesJson: true },
      });
      expect(analyzedEpisode.analyzed).toBe(true);
      const [sceneJson] = analyzedEpisode.scenesJson as Array<{
        sceneReferences?: {
          visibleCharacters: string[];
          mentionedCharacters: string[];
          voiceCharacters: string[];
          visibleItems: string[];
          mentionedItems: string[];
        };
      }>;
      expect(sceneJson?.sceneReferences).toMatchObject({
        visibleCharacters: ['我', '司机'],
        mentionedCharacters: ['池清明'],
        voiceCharacters: ['中年女声'],
        visibleItems: ['手机'],
        mentionedItems: ['篮球'],
      });

      const [passenger, driver, voice, mentioned] = await Promise.all([
        prisma.character.create({ data: { projectId: project.id, name: '我', description: '后座乘客', bio: '' } }),
        prisma.character.create({ data: { projectId: project.id, name: '司机', description: '中年网约车司机', bio: '' } }),
        prisma.character.create({ data: { projectId: project.id, name: '中年女声', description: '电话声音', bio: '' } }),
        prisma.character.create({ data: { projectId: project.id, name: '池清明', description: '被提及的人', bio: '' } }),
      ]);
      for (const character of [passenger, driver, voice, mentioned]) {
        const detailTask = await createQueuedTextTask(user.id, project.id, {
          episodeId: episode.id,
          characterId: character.id,
          analysisType: 'character_detail',
          model: 'stub-text-chain',
        });
        await processTask(detailTask.id);
      }

      const makeAsset = (label: string) => prisma.asset.create({
        data: {
          ownerId: user.id,
          bucket: 'test-fixtures',
          key: `${label}-${Date.now()}-${Math.random()}.png`,
          contentType: 'image/png',
          sizeBytes: 10,
        },
      });
      const [carSceneAsset, phoneAsset] = await Promise.all([
        makeAsset('prepared-car-scene'),
        makeAsset('prepared-phone'),
      ]);
      const [carScene, phoneItem, basketballItem] = await Promise.all([
        prisma.scene.create({
          data: {
            projectId: project.id,
            name: '网约车车内',
            description: '后座、驾驶室、后视镜和雨夜车窗',
            prompt: '雨夜网约车车内空间',
            assetId: carSceneAsset.id,
          },
        }),
        prisma.item.create({
          data: {
            projectId: project.id,
            name: '手机',
            description: '订单页面亮起的手机',
            prompt: '屏幕微光照亮手指',
            assetId: phoneAsset.id,
          },
        }),
        prisma.item.create({
          data: {
            projectId: project.id,
            name: '篮球',
            description: '只在台词中被提到的篮球',
            prompt: '篮球',
          },
        }),
      ]);
      void basketballItem;

      const compositionTask = await createQueuedTextTask(user.id, project.id, {
        projectId: project.id,
        episodeId: episode.id,
        analysisType: 'composition_scene_planning',
        model: 'stub-text-chain',
      });
      await processTask(compositionTask.id);

      const composition = await prisma.compositionTask.findUniqueOrThrow({
        where: { episodeId_sceneIndex: { episodeId: episode.id, sceneIndex: 0 } },
        select: { characterStyleIds: true, sceneIds: true, itemIds: true, prompt: true },
      });
      const styleNames = await styleNamesForIds(composition.characterStyleIds as string[]);
      expect(styleNames).toEqual(expect.arrayContaining(['我 · 后座乘客造型', '司机 · 雨夜接单造型']));
      expect(styleNames).not.toEqual(expect.arrayContaining(['中年女声 · 日常造型', '池清明 · 日常造型']));
      expect(composition.itemIds).toEqual([phoneItem.id]);
      expect(composition.sceneIds).toEqual([carScene.id]);
      expect(composition.prompt).toContain('声音角色仅作为画外声处理');
      expect(composition.prompt).toContain('中年女声');
      expect(composition.prompt).toContain('只被提及的角色不要出现在画面中');

      const shotTask = await createQueuedTextTask(user.id, project.id, {
        episodeId: episode.id,
        sceneIndex: 0,
        analysisType: 'shot_breakdown',
        model: 'stub-text-chain',
      });
      await processTask(shotTask.id);

      const shots = await prisma.shot.findMany({
        where: { episodeId: episode.id, sceneIndex: 0, createType: 'assist' },
        orderBy: { displayId: 'asc' },
        select: { id: true, characterStyleIds: true, sceneIds: true, itemIds: true, roleNames: true },
      });
      expect(shots).toHaveLength(2);
      const firstShotStyleNames = await styleNamesForIds(shots[0]!.characterStyleIds as string[]);
      expect(firstShotStyleNames).toEqual(expect.arrayContaining(['我 · 后座乘客造型', '司机 · 雨夜接单造型']));
      expect(firstShotStyleNames).not.toEqual(expect.arrayContaining(['司机 · 下班居家造型']));
      expect(shots[0]!.itemIds).toEqual([phoneItem.id]);
      expect(shots[0]!.sceneIds).toEqual([carScene.id]);
      expect(shots[1]!.characterStyleIds).toHaveLength(1);
      expect(await styleNamesForIds(shots[1]!.characterStyleIds as string[])).toEqual(['我 · 后座乘客造型']);
      const preparedRuns = await prisma.shotSketchRun.findMany({
        where: { shotId: { in: shots.map((shot) => shot.id) }, source: 'prepared' },
        orderBy: { createdAt: 'asc' },
        select: { shotId: true, prompt: true, referenceAssetIds: true, taskJobId: true, outputAssetId: true, sourceAssetId: true, status: true },
      });
      expect(preparedRuns).toHaveLength(2);
      expect(preparedRuns.every((run) => run.status === 'APPLIED')).toBe(true);
      expect(preparedRuns.every((run) => run.taskJobId === null && run.outputAssetId === null && run.sourceAssetId === null)).toBe(true);
      expect(preparedRuns[0]!.prompt).toContain('请生成一张单张主分镜关键帧图');
      expect(preparedRuns[0]!.prompt).toContain('关键画面');
      expect(preparedRuns[0]!.prompt).not.toContain('秒级动作拆解');
      expect(preparedRuns[0]!.prompt).not.toContain('音效设计');
      expect(preparedRuns[0]!.referenceAssetIds).toEqual(expect.arrayContaining([carSceneAsset.id, phoneAsset.id]));

      const context = await app.request(`/api/projects/${project.id}/composition-tasks/shot-sketch-context`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ shotId: shots[0]!.id }),
      });
      expect(context.status).toBe(200);
      const contextBody = await context.json() as { prompt: string; referenceAssetIds: string[] };
      expect(contextBody.prompt).toBe(preparedRuns[0]!.prompt);
      expect(contextBody.referenceAssetIds).toEqual(expect.arrayContaining(preparedRuns[0]!.referenceAssetIds as string[]));
    } finally {
      await prisma.project.deleteMany({ where: { id: project.id } });
    }
  }, 20000);

  it('keeps manually edited composition refs when shot-sketch context refreshes existing draft tasks', async () => {
    const user = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { id: true },
    });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.create({
      data: {
        ownerId: user.id,
        name: `人工引用保护测试-${Date.now()}`,
        ratio: '16:9',
        style: '写实电影感',
        stylePrompt: '写实电影感',
        analysisModel: 'stub-text-chain',
        imageModel: 'stub',
        videoModel: 'stub',
      },
    });
    const episode = await prisma.storyboardEpisode.create({
      data: {
        projectId: project.id,
        number: 1,
        title: '雨夜网约车',
        content: '我坐进网约车后座，司机在驾驶室。',
        analyzed: true,
        scenesJson: [{
          index: 0,
          title: 'INT. 网约车后座 - 夜',
          content: '我坐进网约车后座，司机在驾驶室。',
          characters: ['我', '司机'],
          environment: '网约车车内',
          sceneReferences: {
            visibleCharacters: ['我', '司机'],
            mentionedCharacters: [],
            voiceCharacters: [],
            backgroundCharacters: [],
            visibleItems: ['手机'],
            mentionedItems: [],
            backgroundItems: [],
          },
        }],
      },
    });

    try {
      const [passenger, driver, carScene, phoneItem] = await Promise.all([
        prisma.character.create({ data: { projectId: project.id, name: '我', description: '乘客', bio: '' } }),
        prisma.character.create({ data: { projectId: project.id, name: '司机', description: '司机', bio: '' } }),
        prisma.scene.create({ data: { projectId: project.id, name: '网约车车内', description: '后座驾驶室', prompt: '' } }),
        prisma.item.create({ data: { projectId: project.id, name: '手机', description: '亮屏手机', prompt: '' } }),
      ]);
      const [passengerStyle, driverStyle] = await Promise.all([
        prisma.characterStyle.create({
          data: {
            characterId: passenger.id,
            name: '用户手选乘客造型',
            prompt: '造型元数据：phase=雨夜乘车；outfit=浅色外套；sceneHint=网约车后座\n乘客造型。',
          },
        }),
        prisma.characterStyle.create({
          data: {
            characterId: driver.id,
            name: '用户未选司机造型',
            prompt: '造型元数据：phase=雨夜接单；outfit=深色夹克；sceneHint=网约车驾驶室\n司机造型。',
          },
        }),
      ]);
      void driverStyle;
      const composition = await prisma.compositionTask.create({
        data: {
          projectId: project.id,
          episodeId: episode.id,
          sceneIndex: 0,
          title: '第1集 · INT. 网约车后座 - 夜',
          scriptExcerpt: '我坐进网约车后座，司机在驾驶室。',
          prompt: '用户手动改过的场景图 prompt',
          characterStyleIds: [passengerStyle.id],
          sceneIds: [carScene.id],
          itemIds: [phoneItem.id],
        },
      });
      const shot = await prisma.shot.create({
        data: {
          episodeId: episode.id,
          displayId: 1,
          sceneIndex: 0,
          prompt: '我坐在后座看手机。',
          model: 'stub',
          ratio: project.ratio,
          createType: 'assist',
          characterStyleIds: [passengerStyle.id],
          sceneIds: [carScene.id],
          itemIds: [phoneItem.id],
          compositionTaskIds: [composition.id],
        },
      });

      const patch = await app.request(`/api/composition-tasks/${composition.id}`, {
        method: 'PATCH',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: '用户二次手动编辑 prompt',
          characterStyleIds: [passengerStyle.id],
          sceneIds: [carScene.id],
          itemIds: [phoneItem.id],
        }),
      });
      expect(patch.status).toBe(200);

      const context = await app.request(`/api/projects/${project.id}/composition-tasks/shot-sketch-context`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ shotId: shot.id }),
      });
      expect(context.status).toBe(200);

      const fresh = await prisma.compositionTask.findUniqueOrThrow({
        where: { id: composition.id },
        select: { prompt: true, characterStyleIds: true, sceneIds: true, itemIds: true },
      });
      expect(fresh.prompt).toBe('用户二次手动编辑 prompt');
      expect(fresh.characterStyleIds).toEqual([passengerStyle.id]);
      expect(fresh.sceneIds).toEqual([carScene.id]);
      expect(fresh.itemIds).toEqual([phoneItem.id]);
    } finally {
      await prisma.project.deleteMany({ where: { id: project.id } });
    }
  });

  it('creates shot sketch task with storyboard prompt and prefilled reference assets', async () => {
    const user = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { id: true },
    });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.create({
      data: {
        ownerId: user.id,
        name: `主分镜预填测试-${Date.now()}`,
        ratio: '16:9',
        style: '写实电影感',
        stylePrompt: '写实电影感，雨夜冷色调',
        analysisModel: 'stub-text-chain',
        imageModel: 'stub',
        videoModel: 'stub',
      },
    });
    const episode = await prisma.storyboardEpisode.create({
      data: {
        projectId: project.id,
        number: 1,
        title: '雨夜网约车',
        content: '我坐进网约车后座，司机在驾驶室，手机屏幕亮起。',
        analyzed: true,
        scenesJson: [{
          index: 0,
          title: 'INT. 网约车后座 - 夜',
          content: '我坐进网约车后座，司机在驾驶室，手机屏幕亮起。',
          characters: ['我', '司机'],
          environment: '雨夜网约车车内',
          sceneReferences: {
            visibleCharacters: ['我', '司机'],
            mentionedCharacters: [],
            voiceCharacters: [],
            backgroundCharacters: [],
            visibleItems: ['手机'],
            mentionedItems: [],
            backgroundItems: [],
          },
        }],
      },
    });

    try {
      const makeAsset = (label: string) => prisma.asset.create({
        data: {
          ownerId: user.id,
          bucket: 'test-fixtures',
          key: `${label}-${Date.now()}-${Math.random()}.png`,
          contentType: 'image/png',
          sizeBytes: 10,
        },
      });
      const [
        compositionAsset,
        passengerIdentityAsset,
        passengerStyleAsset,
        carSceneAsset,
        phoneAsset,
      ] = await Promise.all([
        makeAsset('composition'),
        makeAsset('passenger-identity'),
        makeAsset('passenger-style'),
        makeAsset('car-scene'),
        makeAsset('phone'),
      ]);
      const [passenger, driver, carScene, pendingScene, phoneItem] = await Promise.all([
        prisma.character.create({
          data: {
            projectId: project.id,
            name: '我',
            description: '后座乘客',
            bio: '',
            identityAssetId: passengerIdentityAsset.id,
          },
        }),
        prisma.character.create({ data: { projectId: project.id, name: '司机', description: '司机', bio: '' } }),
        prisma.scene.create({
          data: {
            projectId: project.id,
            name: '网约车车内',
            description: '后座、驾驶室、雨夜车窗',
            prompt: '',
            assetId: carSceneAsset.id,
          },
        }),
        prisma.scene.create({
          data: {
            projectId: project.id,
            name: '网约车后座待生成',
            description: '缺失但正在生成的车厢参考',
            prompt: '',
          },
        }),
        prisma.item.create({
          data: {
            projectId: project.id,
            name: '手机',
            description: '亮屏手机',
            prompt: '',
            assetId: phoneAsset.id,
          },
        }),
      ]);
      void driver;
      const pendingSceneResource = await prisma.resourceImage.create({
        data: {
          ownerId: user.id,
          projectId: project.id,
          kind: 'scene',
          source: 'generated',
          status: TaskStatus.RUNNING,
          prompt: '正在生成的车厢参考',
          model: 'stub',
          ratio: project.ratio,
          sceneId: pendingScene.id,
        },
      });
      const passengerStyle = await prisma.characterStyle.create({
        data: {
          characterId: passenger.id,
          name: '后座乘客造型',
          prompt: '造型元数据：phase=雨夜乘车；outfit=浅色外套；sceneHint=网约车后座\n乘客造型。',
          assetId: passengerStyleAsset.id,
        },
      });
      const composition = await prisma.compositionTask.create({
        data: {
          projectId: project.id,
          episodeId: episode.id,
          sceneIndex: 0,
          title: '第1集 · INT. 网约车后座 - 夜',
          scriptExcerpt: '我坐进网约车后座，司机在驾驶室，手机屏幕亮起。',
          prompt: '主场景图 prompt',
          imageAssetId: compositionAsset.id,
          characterStyleIds: [],
          sceneIds: [carScene.id],
          itemIds: [],
        },
      });
      const compositionRun = await prisma.compositionImageRun.create({
        data: {
          taskId: composition.id,
          prompt: '主场景图 prompt',
          model: 'stub',
          ratio: project.ratio,
          status: 'SUCCEEDED',
          outputAssetId: compositionAsset.id,
        },
      });
      await prisma.compositionTask.update({
        where: { id: composition.id },
        data: {
          currentImageRunId: compositionRun.id,
          imageAssetId: compositionAsset.id,
        },
      });
      const shot = await prisma.shot.create({
        data: {
          episodeId: episode.id,
          displayId: 1,
          sceneIndex: 0,
          prompt: '中景，我坐在后座看着亮起的手机，司机在前景虚化。',
          model: 'stub',
          ratio: project.ratio,
          createType: 'assist',
          characterStyleIds: [passengerStyle.id],
          sceneIds: [carScene.id, pendingScene.id],
          itemIds: [phoneItem.id],
          compositionTaskIds: [composition.id],
        },
      });
      const context = await app.request(`/api/projects/${project.id}/composition-tasks/shot-sketch-context`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ shotId: shot.id }),
      });
      expect(context.status).toBe(200);
      const contextBody = await context.json() as {
        referenceAssets: Array<{
          source: string;
          sourceId: string | null;
          missing?: boolean;
          resourceImageId?: string | null;
          resourceStatus?: string | null;
        }>;
      };
      expect(contextBody.referenceAssets).toEqual(expect.arrayContaining([
        expect.objectContaining({
          source: 'scene',
          sourceId: pendingScene.id,
          missing: true,
          resourceImageId: pendingSceneResource.id,
          resourceStatus: TaskStatus.RUNNING,
        }),
      ]));

      const res = await app.request(`/api/projects/${project.id}/composition-tasks/generate-shot-sketch`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ shotId: shot.id }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { taskId: string; runId: string; referenceAssetIds: string[] };
      expect(body.referenceAssetIds).toEqual([
        compositionAsset.id,
        passengerStyleAsset.id,
        carSceneAsset.id,
        phoneAsset.id,
      ]);
      expect(body.referenceAssetIds).not.toContain(passengerIdentityAsset.id);
      expect(new Set(body.referenceAssetIds).size).toBe(body.referenceAssetIds.length);

      const task = await prisma.task.findUniqueOrThrow({
        where: { id: body.taskId },
        select: { input: true },
      });
      const input = task.input as {
        prompt?: string;
        referenceAssetIds?: string[];
        shotSketch?: boolean;
        shotId?: string;
        compositionTaskId?: string;
      };
      expect(input.shotSketch).toBe(true);
      expect(input.shotId).toBe(shot.id);
      expect(input.compositionTaskId).toBe(composition.id);
      expect(input.referenceAssetIds).toEqual(body.referenceAssetIds);
      expect(input.prompt).toContain('请生成一张单张主分镜关键帧图');
      expect(input.prompt).toContain('不是视频生成提示词');
      expect(input.prompt).toContain('优先呈现画面构图、景别、机位、光线、色彩和情绪');
      expect(input.prompt).toContain('关键画面');
      expect(input.prompt).toContain('中景，我坐在后座看着亮起的手机');
      expect(input.prompt).not.toContain('秒级动作拆解');
      expect(input.prompt).not.toContain('音效设计');
      expect(input.prompt).toContain('INT. 网约车后座 - 夜');
      expect(input.prompt).toContain('写实电影感，雨夜冷色调');

      const run = await prisma.shotSketchRun.findUniqueOrThrow({
        where: { id: body.runId },
        select: { prompt: true, referenceAssetIds: true, taskJobId: true },
      });
      expect(run.taskJobId).toBe(body.taskId);
      expect(run.prompt).toBe(input.prompt);
      expect(run.referenceAssetIds).toEqual(body.referenceAssetIds);
    } finally {
      await prisma.project.deleteMany({ where: { id: project.id } });
    }
  });

  it('retryable TEXT provider error returns to QUEUED for BullMQ retry instead of terminal FAILED', async () => {
    const user = await prisma.user.findUnique({
      where: { email: SEED_USER_EMAIL },
      select: { id: true, credits: true },
    });
    if (!user) throw new Error('Seed user missing.');
    const project = await prisma.project.findFirst({ where: { ownerId: user.id } });
    if (!project) throw new Error('Seed project missing.');
    const episode = await prisma.storyboardEpisode.findFirst({ where: { projectId: project.id } });
    if (!episode) throw new Error('Seed episode missing.');
    const task = await prisma.task.create({
      data: {
        ownerId: user.id,
        projectId: project.id,
        type: TaskType.TEXT_ANALYZE,
        provider: 'stub',
        status: TaskStatus.QUEUED,
        costCredits: 1,
        input: { episodeId: episode.id, analysisType: 'general', model: 'test-openai-429' },
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { credits: { decrement: task.costCredits } },
    });

    try {
      await expect(processTask(task.id, { attemptsMade: 0, attempts: 3 })).rejects.toThrow(
        'http_429',
      );
      const fresh = await prisma.task.findUnique({
        where: { id: task.id },
        select: { status: true, completedAt: true },
      });
      expect(fresh?.status).toBe(TaskStatus.QUEUED);
      expect(fresh?.completedAt).toBeNull();
      const after = await prisma.user.findUnique({
        where: { id: user.id },
        select: { credits: true },
      });
      expect(after?.credits).toBe(user.credits - task.costCredits);
    } finally {
      await prisma.user.update({
        where: { id: user.id },
        data: { credits: user.credits },
      });
      await prisma.task.deleteMany({ where: { id: task.id } });
    }
  });

	  it(
	    'IMAGE task with STUB_FAIL_RATE=1 fails and refunds credits',
	    async () => {
	      process.env.STUB_FAIL_RATE = '1';
	      let taskId: string | null = null;
	      try {
	        const user = await prisma.user.findUnique({
	          where: { email: SEED_USER_EMAIL },
	          select: { id: true, credits: true },
	        });
	        if (!user) throw new Error('Seed user missing.');
	        const task = await prisma.task.create({
	          data: {
	            ownerId: user.id,
	            type: TaskType.IMAGE,
	            provider: 'stub',
	            status: TaskStatus.QUEUED,
	            costCredits: 1,
	            input: { prompt: 'doomed', ratio: '1:1', model: 'stub', n: 1 },
	          },
	        });
	        taskId = task.id;
	        await prisma.user.update({
	          where: { id: user.id },
	          data: { credits: { decrement: task.costCredits } },
	        });

	        await expect(processTask(task.id)).rejects.toThrow('stub-image');
	        const fresh = await prisma.task.findUnique({
	          where: { id: task.id },
	          select: { status: true },
	        });
	        expect(fresh?.status).toBe(TaskStatus.FAILED);

	        const after = await prisma.user.findUnique({
	          where: { email: SEED_USER_EMAIL },
	          select: { credits: true },
	        });
	        expect(after!.credits).toBe(user.credits);
	      } finally {
	        process.env.STUB_FAIL_RATE = '0';
	        if (taskId) await prisma.task.deleteMany({ where: { id: taskId } });
	      }
	    },
	    15000,
	  );

  it('POST cancel on QUEUED task refunds credits', async () => {
    // Briefly pause the image worker to make the task sit in QUEUED.
    const imageWorker = workers.find((w) => w.name === QueueNames.IMAGE)!;
    await imageWorker.pause();

    try {
      const before = await prisma.user.findUnique({
        where: { email: SEED_USER_EMAIL },
        select: { credits: true },
      });
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'IMAGE',
          provider: 'stub',
          input: { prompt: 'cancel me', ratio: '1:1', model: 'stub', n: 1 },
        }),
      });
      const { id } = (await res.json()) as { id: string };
      // Should still be QUEUED since worker is paused
      const fresh = await prisma.task.findUnique({
        where: { id },
        select: { status: true },
      });
      expect(fresh?.status).toBe('QUEUED');

      const cancel = await app.request(`/api/tasks/${id}/cancel`, {
        method: 'POST',
        headers: auth,
      });
      expect(cancel.status).toBe(200);
      const body = (await cancel.json()) as { status: string };
      expect(body.status).toBe('CANCELLED');

      const refundedCredits = await pollCreditsAtLeast(
        SEED_USER_EMAIL,
        before?.credits ?? 0,
      );
      expect(refundedCredits).toBeGreaterThanOrEqual(before?.credits ?? 0);
    } finally {
      await imageWorker.resume();
    }
  });

  it('POST cancel on terminal task returns 409', async () => {
    const res = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'IMAGE',
        provider: 'stub',
        input: { prompt: 'finish-fast', ratio: '1:1', model: 'stub', n: 1 },
      }),
    });
    const { id } = (await res.json()) as { id: string };
    await pollUntilTerminal(id);

    const cancel = await app.request(`/api/tasks/${id}/cancel`, {
      method: 'POST',
      headers: auth,
    });
    expect(cancel.status).toBe(409);
  });

  it('GET /api/tasks lists with cursor pagination', async () => {
    const res = await app.request('/api/tasks?limit=2', { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; nextCursor: string | null };
    expect(body.items.length).toBeLessThanOrEqual(2);
  });

  it('PATCH /api/internal/tasks/:id without secret returns 403', async () => {
    const post = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'IMAGE',
        provider: 'stub',
        input: { prompt: 'x', ratio: '1:1', model: 'stub' },
      }),
    });
    const { id } = (await post.json()) as { id: string };

    const res = await app.request(`/api/internal/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'FAILED', error: 'external' }),
    });
    expect(res.status).toBe(403);
  });

  it('PATCH /api/internal/tasks/:id with correct secret updates the task', async () => {
    const post = await app.request('/api/tasks', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'IMAGE',
        provider: 'stub',
        input: { prompt: 'x', ratio: '1:1', model: 'stub' },
      }),
    });
    const { id } = (await post.json()) as { id: string };
    // wait for it to settle so we have something to override
    await pollUntilTerminal(id);

    const res = await app.request(`/api/internal/tasks/${id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': config.INTERNAL_SECRET,
      },
      body: JSON.stringify({ output: { externallyOverridden: true } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { output: { externallyOverridden: boolean } };
    expect(body.output.externallyOverridden).toBe(true);
  });
});
