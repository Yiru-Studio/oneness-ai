import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Worker } from 'bullmq';
import { taskRoutes } from '../../src/routes/tasks.js';
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

  it('character-style IMAGE task refuses to generate without an identity master', async () => {
    const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
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
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toContain('身份母版');
    } finally {
      await prisma.character.deleteMany({ where: { id: character.id } });
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
