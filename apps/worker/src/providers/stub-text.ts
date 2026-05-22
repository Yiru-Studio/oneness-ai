import type {
  TextProvider,
  TextInput,
  ProviderContext,
  ProviderResult,
} from '@oneness/shared/providers';

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
    if ('analysisType' in input && input.analysisType === 'resource_prompt') {
      await sleep(1000, ctx.abortSignal);
      if (Math.random() < currentFailRate()) {
        throw new Error('stub-text: random failure (STUB_FAIL_RATE)');
      }
      const label =
        input.kind === 'character-style'
          ? '人物造型设定图'
          : input.kind === 'scene'
            ? '场景主视觉'
            : '道具特写';
      return {
        outputJson: {
          kind: 'stub-text',
          analysisType: 'resource_prompt',
          resourceKind: input.kind,
          entityId: input.entityId,
          prompt: `（stub）${label}，主体清晰，细节明确，电影感光线，符合项目整体视觉风格。`,
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
              prompt: s.prompt,
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
    const seed = [
      { name: '旧信', description: '贯穿告别仪式的泛黄信件，承载母亲对亡子的多年思念。' },
      { name: '钢笔', description: '吴雨华写信时使用的旧钢笔，带有长期使用的磨损痕迹。' },
      { name: '搪瓷杯', description: '老家桌上的日常旧物，提示房间的年代感和生活气息。' },
      { name: '老花镜', description: '吴雨华看信写信时依赖的物件，体现她的年纪和视力状态。' },
    ];
    const rows = await ctx.prisma.$transaction(
      seed.map((item) => ctx.prisma.item.create({ data: { projectId, ...item } })),
    );
    return rows.map((r) => r.id);
  }
  // scenes
  const seed = [
    {
      name: 'INT. 老旧家属楼 - 午后',
      description: '初夏强光照进陈旧家属楼室内，桌面摆满旧信、药瓶和生活杂物。',
    },
    {
      name: 'EXT. 街道 - 黄昏',
      description: '撤离中的老街人群拖着行李穿行，远处气象泡带来异常虹彩光线。',
    },
    {
      name: 'INT. 邮局 - 夜',
      description: '夜晚邮局灯光冷清，旧邮戳和柜台形成带年代感的告别空间。',
    },
  ];
  const rows = await ctx.prisma.$transaction(
    seed.map((scene) => ctx.prisma.scene.create({ data: { projectId, ...scene } })),
  );
  return rows.map((r) => r.id);
}
