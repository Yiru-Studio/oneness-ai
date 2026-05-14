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
