import type {
  TextProvider,
  TextInput,
  ProviderContext,
  ProviderResult,
} from '@oneness/shared/providers';
import { sanitizeShotVideoPrompt } from '@oneness/shared/shot-prompts';

function currentFailRate(): number {
  const v = Number(process.env.STUB_FAIL_RATE ?? '0.05');
  return Number.isFinite(v) ? v : 0.05;
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(() => resolve(), ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

export const stubTextProvider: TextProvider = {
  name: 'stub',
  async analyze(input: TextInput, ctx: ProviderContext): Promise<ProviderResult> {
    if ('analysisType' in input && input.analysisType === 'composition_scene_planning') {
      await sleep(1500, ctx.abortSignal);
      const project = await ctx.prisma.project.findFirst({
        where: { id: input.projectId, ownerId: ctx.ownerId },
        select: { id: true },
      });
      if (!project) throw new Error(`project not found: ${input.projectId}`);
      const episodes = await ctx.prisma.storyboardEpisode.findMany({
        where: { projectId: project.id, ...(input.episodeId ? { id: input.episodeId } : {}) },
        orderBy: { number: 'asc' },
      });
      const ids = await ctx.prisma.$transaction(async (tx) => {
        const out: string[] = [];
        for (const episode of episodes) {
          const rawScenes = Array.isArray(episode.scenesJson) ? episode.scenesJson : [];
          const scenes = rawScenes.length > 0
            ? rawScenes
            : [{ index: 0, title: episode.title, content: episode.content, environment: '' }];
          for (const [fallbackIndex, item] of scenes.entries()) {
            const obj = item && typeof item === 'object' ? item as Record<string, unknown> : {};
            const sceneIndex = typeof obj.index === 'number' ? obj.index : fallbackIndex;
            const titleText = typeof obj.title === 'string' && obj.title.trim()
              ? obj.title.trim()
              : `场景 ${sceneIndex + 1}`;
            const content = typeof obj.content === 'string' ? obj.content : episode.content;
            const row = await tx.compositionTask.upsert({
              where: { episodeId_sceneIndex: { episodeId: episode.id, sceneIndex } },
              create: {
                projectId: project.id,
                episodeId: episode.id,
                sceneIndex,
                title: `第${episode.number}集 · ${titleText}`,
                scriptExcerpt: content.slice(0, 180),
                prompt: `（stub）场景图：${titleText}。${content.slice(0, 260)}`,
              },
              update: {
                title: `第${episode.number}集 · ${titleText}`,
                scriptExcerpt: content.slice(0, 180),
              },
              select: { id: true },
            });
            out.push(row.id);
          }
        }
        return out;
      });
      return {
        outputJson: {
          kind: 'stub-text',
          analysisType: 'composition_scene_planning',
          projectId: project.id,
          episodeId: input.episodeId ?? null,
          taskCount: ids.length,
          compositionTaskIds: ids,
        },
      };
    }

    if ('subjectType' in input) {
      ctx.log.info(
        { episodeId: input.episodeId, subjectType: input.subjectType },
        'stub-text extract start',
      );
      await sleep(2000, ctx.abortSignal);

      if (Math.random() < currentFailRate()) {
        throw new Error('stub-text: random failure (STUB_FAIL_RATE)');
      }

      const ep = await ctx.prisma.storyboardEpisode.findUnique({
        where: { id: input.episodeId },
        select: { projectId: true },
      });
      if (!ep) throw new Error(`episode not found: ${input.episodeId}`);

      const ids = await persistStubEntities(ctx, ep.projectId, input.subjectType);
      return {
        outputJson: {
          kind: 'stub-text',
          episodeId: input.episodeId,
          subjectType: input.subjectType,
          createdIds: ids,
        },
      };
    }

    // Storyboard "分析剧集" — mock a scene breakdown.
    if (input.analysisType === 'scene_list') {
      await sleep(1500, ctx.abortSignal);
      const scenes = [
        {
          index: 0,
          title: '擂台开场 夜 内',
          content: '聚光灯下的擂台，主角迎战对手，观众沸腾。',
          characters: ['主角', '对手'],
          environment: '灯光聚焦的职业格斗擂台，四周铁网围绳，地面血迹斑斑。',
        },
        {
          index: 1,
          title: '观众席 夜 内',
          content: '观众席人头攒动，齐声呐喊主角的名字。',
          characters: ['观众'],
          environment: '昏暗的体育馆看台，彩色氛围灯扫过欢呼的人群。',
        },
      ];
      await ctx.prisma.storyboardEpisode.update({
        where: { id: input.episodeId },
        data: {
          analyzed: true,
          summary: '（stub）本集为格斗开场的演示分析。',
          scenesJson: scenes as never,
        },
      });
      return {
        outputJson: {
          kind: 'stub-text',
          episodeId: input.episodeId,
          analysisType: 'scene_list',
          sceneCount: scenes.length,
        },
      };
    }

    // AI-assist "智能分镜创作" — mock a couple of shots.
    if (input.analysisType === 'shot_breakdown') {
      await sleep(1500, ctx.abortSignal);
      const sceneIndex = input.sceneIndex;
      const mock = [
        { shotType: 'new', duration: 4, prompt: '全景，固定镜头，俯视，擂台全貌，灯光聚焦。', roles: [] },
        { shotType: 'continue', duration: 5, prompt: '中景，缓推，平视，主角摆出防守姿态，冷蓝色调。', roles: ['主角'] },
      ];
      const ids = await ctx.prisma.$transaction(async (tx) => {
        await tx.shot.deleteMany({ where: { episodeId: input.episodeId, sceneIndex, createType: 'assist' } });
        const agg = await tx.shot.aggregate({ where: { episodeId: input.episodeId }, _max: { displayId: true } });
        let displayId = agg._max.displayId ?? 0;
        let prev: number | null = null;
        const out: string[] = [];
        for (const s of mock) {
          displayId += 1;
          const isContinue = s.shotType === 'continue' && prev !== null;
          const row = await tx.shot.create({
            data: {
              episodeId: input.episodeId,
              displayId,
              sceneIndex,
              shotType: isContinue ? 'continuation' : 'new',
              preId: isContinue ? prev : null,
              duration: s.duration,
              prompt: sanitizeShotVideoPrompt(s.prompt),
              model: 'stub',
              createType: 'assist',
              roleNames: s.roles as never,
            },
            select: { id: true },
          });
          out.push(row.id);
          prev = displayId;
        }
        return out;
      });
      return {
        outputJson: {
          kind: 'stub-text',
          episodeId: input.episodeId,
          analysisType: 'shot_breakdown',
          sceneIndex,
          shotCount: ids.length,
        },
      };
    }

    ctx.log.info(
      { episodeId: input.episodeId, analysisType: input.analysisType },
      'stub-text start',
    );
    await sleep(2000, ctx.abortSignal);

    if (Math.random() < currentFailRate()) {
      throw new Error('stub-text: random failure (STUB_FAIL_RATE)');
    }

    return {
      outputJson: {
        kind: 'stub-text',
        episodeId: input.episodeId,
        analysisType: input.analysisType,
        summary: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
        keyPoints: ['stub point a', 'stub point b', 'stub point c'],
      },
    };
  },
};

async function persistStubEntities(
  ctx: ProviderContext,
  projectId: string,
  subjectType: 'characters' | 'items' | 'scenes',
): Promise<string[]> {
  if (subjectType === 'characters') {
    const seed = [
      { name: '主角', description: '故事的核心人物', bio: '一名背负使命的旅人。' },
      { name: '导师', description: '主角的引路人', bio: '历经沧桑的智者。' },
      { name: '反派', description: '主要冲突来源', bio: '野心勃勃的对手。' },
    ];
    const rows = await ctx.prisma.$transaction(
      seed.map((s) =>
        ctx.prisma.character.create({
          data: { projectId, name: s.name, description: s.description, bio: s.bio },
        }),
      ),
    );
    return rows.map((r) => r.id);
  }
  if (subjectType === 'items') {
    const seed = ['旧信', '钢笔', '搪瓷杯', '老花镜'];
    const rows = await ctx.prisma.$transaction(
      seed.map((name) => ctx.prisma.item.create({ data: { projectId, name } })),
    );
    return rows.map((r) => r.id);
  }
  // scenes
  const seed = ['INT. 老旧家属楼 - 午后', 'EXT. 街道 - 黄昏', 'INT. 邮局 - 夜'];
  const rows = await ctx.prisma.$transaction(
    seed.map((name) => ctx.prisma.scene.create({ data: { projectId, name } })),
  );
  return rows.map((r) => r.id);
}
