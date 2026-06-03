import type {
  TextProvider,
  TextInput,
  ProviderContext,
  ProviderResult,
} from '@oneness/shared/providers';
import { sanitizeShotVideoPrompt } from '@oneness/shared/shot-prompts';
import {
  currentCompositionImageAssetId,
  prepareShotSketchRun,
} from '@oneness/shared/shot-sketch-preparation';
import {
  buildSceneImageCompositionPrompt,
  cleanSceneImageSummary,
  normalizeSceneReferenceVisibility,
  prefillCompositionReferences,
  type EpisodeScene,
  type ReferenceLibraryForPlanning,
  type SceneImageReferenceIds,
} from '@oneness/shared/composition-planning';
import { resolveShotReferencesFromNames } from '../lib/shot-reference-prefill.js';

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
    if (input.model === 'test-openai-429') {
      throw new Error('openai[http_429]: rate_limit');
    }

    if ('analysisType' in input && input.analysisType === 'character_detail') {
      await sleep(500, ctx.abortSignal);
      const character = await ctx.prisma.character.findFirst({
        where: {
          id: input.characterId,
          project: { ownerId: ctx.ownerId },
        },
        include: { project: true },
      });
      if (!character) throw new Error(`character not found: ${input.characterId}`);
      await ctx.prisma.$transaction(async (tx) => {
        await tx.character.update({
          where: { id: character.id },
          data: {
            description: `${character.name} 的自动角色解析描述`,
            bio: `${character.name} 的自动角色解析小传。`,
            avatarPrompt: `${character.name} 头像，面部特征清晰，简洁背景。`,
          },
        });
        await tx.characterStyle.deleteMany({
          where: { characterId: character.id, assetId: null },
        });
        const styles = input.model === 'stub-text-chain'
          ? stubTextChainStyles(character.name)
          : [
              {
                name: '日常造型',
                prompt: `${character.name} 日常造型，全身角色参考图，简洁背景。`,
              },
              {
                name: '剧情高光造型',
                prompt: `${character.name} 剧情高光造型，全身角色参考图，简洁背景。`,
              },
            ];
        await tx.characterStyle.createMany({
          data: styles.map((style) => ({
            characterId: character.id,
            name: style.name,
            prompt: style.prompt,
            model: character.project.imageModel,
            ratio: character.project.ratio,
          })),
        });
      });
      return {
        outputJson: {
          kind: 'stub-text',
          analysisType: 'character_detail',
          episodeId: input.episodeId,
          characterId: input.characterId,
          styleCount: 2,
        },
        actualCostCredits: 0,
      };
    }

    if ('analysisType' in input && input.analysisType === 'composition_scene_planning') {
      await sleep(1500, ctx.abortSignal);
      const project = await ctx.prisma.project.findFirst({
        where: { id: input.projectId, ownerId: ctx.ownerId },
        select: { id: true, ratio: true, stylePrompt: true },
      });
      if (!project) throw new Error(`project not found: ${input.projectId}`);
      const episodes = await ctx.prisma.storyboardEpisode.findMany({
        where: { projectId: project.id, ...(input.episodeId ? { id: input.episodeId } : {}) },
        orderBy: { number: 'asc' },
      });
      const ids = await ctx.prisma.$transaction(async (tx) => {
        const out: string[] = [];
        for (const episode of episodes) {
          const library = await loadStubReferenceLibrary(ctx, project.id);
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
            const scene = sceneFromStubObject(obj, fallbackIndex, episode.title, episode.content);
            const refs = prefillCompositionReferences(scene, library);
            const prompt = buildStubCompositionPrompt(project, scene, refs, library);
            const row = await tx.compositionTask.upsert({
              where: { episodeId_sceneIndex: { episodeId: episode.id, sceneIndex } },
              create: {
                projectId: project.id,
                episodeId: episode.id,
                sceneIndex,
                title: `第${episode.number}集 · ${titleText}`,
                scriptExcerpt: content.slice(0, 180),
                prompt,
                characterStyleIds: refs.characterStyleIds as never,
                sceneIds: refs.sceneIds as never,
                itemIds: refs.itemIds as never,
              },
              update: {
                title: `第${episode.number}集 · ${titleText}`,
                scriptExcerpt: content.slice(0, 180),
                prompt,
                characterStyleIds: refs.characterStyleIds as never,
                sceneIds: refs.sceneIds as never,
                itemIds: refs.itemIds as never,
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
      const scenes = input.model === 'stub-text-chain' ? stubTextChainScenes() : [
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
      const mock = input.model === 'stub-text-chain' ? [
        {
          shotType: 'new',
          duration: 4,
          prompt: '中景，网约车驾驶室和后座同框，司机穿深色夹克透过后视镜观察后座乘客，我低头看手机。',
          roles: ['司机', '我'],
          items: ['手机'],
        },
        {
          shotType: 'continue',
          duration: 5,
          prompt: '近景，手机屏幕的订单页面微光照亮乘客手指，电话里的中年女声只作为画外声出现。',
          roles: ['我'],
          items: ['手机'],
        },
      ] : [
        { shotType: 'new', duration: 4, prompt: '全景，固定镜头，俯视，擂台全貌，灯光聚焦。', roles: [] },
        { shotType: 'continue', duration: 5, prompt: '中景，缓推，平视，主角摆出防守姿态，冷蓝色调。', roles: ['主角'] },
      ];
      const referenceContext = input.model === 'stub-text-chain'
        ? await loadStubShotReferenceContext(ctx, input.episodeId, sceneIndex)
        : null;
      const createdShots = await ctx.prisma.$transaction(async (tx) => {
        await tx.shot.deleteMany({ where: { episodeId: input.episodeId, sceneIndex, createType: 'assist' } });
        const agg = await tx.shot.aggregate({ where: { episodeId: input.episodeId }, _max: { displayId: true } });
        let displayId = agg._max.displayId ?? 0;
        let prev: number | null = null;
        const out: Array<{
          id: string;
          displayId: number;
          shotType: string;
          duration: number;
          prompt: string;
          compositionTaskIds: unknown;
          characterStyleIds: unknown;
          sceneIds: unknown;
          itemIds: unknown;
        }> = [];
        for (const s of mock) {
          displayId += 1;
          const isContinue = s.shotType === 'continue' && prev !== null;
          const refs = referenceContext
            ? resolveShotReferencesFromNames({
                roles: s.roles,
                items: 'items' in s && Array.isArray(s.items) ? s.items : [],
                ...referenceContext,
              })
            : { characterStyleIds: [], sceneIds: [], itemIds: [] };
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
              characterStyleIds: refs.characterStyleIds as never,
              sceneIds: refs.sceneIds as never,
              itemIds: refs.itemIds as never,
            },
            select: {
              id: true,
              displayId: true,
              shotType: true,
              duration: true,
              prompt: true,
              compositionTaskIds: true,
              characterStyleIds: true,
              sceneIds: true,
              itemIds: true,
            },
          });
          out.push(row);
          prev = displayId;
        }
        return out;
      });
      let preparedCount = 0;
      try {
        preparedCount = await prepareStubShotSketches(ctx, input.episodeId, sceneIndex, createdShots);
      } catch (err) {
        ctx.log.warn(
          { err: (err as Error).message, episodeId: input.episodeId, sceneIndex },
          'stub shot sketch preparation failed after shot breakdown',
        );
      }
      return {
        outputJson: {
          kind: 'stub-text',
          episodeId: input.episodeId,
          analysisType: 'shot_breakdown',
          sceneIndex,
          shotCount: createdShots.length,
          preparedShotSketchCount: preparedCount,
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

function stubTextChainScenes() {
  return [{
    index: 0,
    title: 'INT. 网约车后座 / 驾驶室 - 夜',
    content: '雨夜，我坐进网约车后座，司机穿深色夹克透过后视镜观察我。手机订单页面亮着，电话里的中年女声提到池清明和篮球。',
    characters: ['我', '司机', '中年女声', '池清明'],
    environment: '潮湿闷热的网约车车内，后座、驾驶室、后视镜和雨夜车窗形成压抑空间。',
    sceneReferences: {
      visibleCharacters: ['我', '司机'],
      mentionedCharacters: ['池清明'],
      voiceCharacters: ['中年女声'],
      backgroundCharacters: [],
      visibleItems: ['手机'],
      mentionedItems: ['篮球'],
      backgroundItems: ['网约车'],
    },
  }];
}

function stubTextChainStyles(characterName: string): Array<{ name: string; prompt: string }> {
  if (characterName === '司机') {
    return [
      {
        name: '下班居家造型',
        prompt: '造型元数据：phase=下班回家；outfit=灰色毛衣；sceneHint=家中\n司机居家造型，全身角色参考图，简洁背景。',
      },
      {
        name: '雨夜接单造型',
        prompt: '造型元数据：phase=雨夜接单；outfit=深色夹克；sceneHint=网约车驾驶室\n司机穿深色夹克，全身角色参考图，简洁背景。',
      },
    ];
  }
  if (characterName === '我') {
    return [
      {
        name: '后座乘客造型',
        prompt: '造型元数据：phase=雨夜乘车；outfit=浅色外套；sceneHint=网约车后座\n乘客浅色外套，全身角色参考图，简洁背景。',
      },
      {
        name: '回忆造型',
        prompt: '造型元数据：phase=校园回忆；outfit=校服；sceneHint=校园\n乘客校园回忆造型，全身角色参考图，简洁背景。',
      },
    ];
  }
  return [
    {
      name: '日常造型',
      prompt: `造型元数据：phase=日常；outfit=常服；sceneHint=普通空间\n${characterName} 日常造型，全身角色参考图，简洁背景。`,
    },
    {
      name: '剧情高光造型',
      prompt: `造型元数据：phase=剧情高光；outfit=剧情服装；sceneHint=关键场景\n${characterName} 剧情高光造型，全身角色参考图，简洁背景。`,
    },
  ];
}

function sceneFromStubObject(
  obj: Record<string, unknown>,
  fallbackIndex: number,
  fallbackTitle: string,
  fallbackContent: string,
): EpisodeScene {
  const characters = Array.isArray(obj.characters)
    ? obj.characters.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    index: typeof obj.index === 'number' ? obj.index : fallbackIndex,
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title : `${fallbackTitle} ${fallbackIndex + 1}`,
    content: typeof obj.content === 'string' ? obj.content : fallbackContent,
    characters,
    environment: typeof obj.environment === 'string' ? obj.environment : '',
    sceneReferences: normalizeSceneReferenceVisibility(
      typeof obj.sceneReferences === 'object' && obj.sceneReferences !== null
        ? obj.sceneReferences as Record<string, string[]>
        : null,
      { characters, scenes: [], items: [] },
    ),
  };
}

async function loadStubReferenceLibrary(
  ctx: ProviderContext,
  projectId: string,
): Promise<ReferenceLibraryForPlanning> {
  const [characters, scenes, items] = await Promise.all([
    ctx.prisma.character.findMany({
      where: { projectId },
      include: { styles: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
    ctx.prisma.scene.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
    ctx.prisma.item.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
  ]);
  return { characters, scenes, items };
}

function buildStubCompositionPrompt(
  project: { ratio: string; stylePrompt: string },
  scene: EpisodeScene,
  refs: SceneImageReferenceIds,
  library: ReferenceLibraryForPlanning,
): string {
  const styleLabels = new Map<string, string>();
  for (const character of library.characters) {
    for (const style of character.styles) styleLabels.set(style.id, `${character.name} · ${style.name}`);
  }
  const sceneLabels = new Map(library.scenes.map((sceneRow) => [sceneRow.id, sceneRow.name]));
  const itemLabels = new Map(library.items.map((item) => [item.id, item.name]));
  return buildSceneImageCompositionPrompt(
    project,
    { ...scene, content: cleanSceneImageSummary(scene.content) },
    {
      ...refs,
      characterStyleLabels: refs.characterStyleIds.map((id) => styleLabels.get(id)).filter((item): item is string => Boolean(item)),
      sceneLabels: refs.sceneIds.map((id) => sceneLabels.get(id)).filter((item): item is string => Boolean(item)),
      itemLabels: refs.itemIds.map((id) => itemLabels.get(id)).filter((item): item is string => Boolean(item)),
    },
  );
}

async function loadStubShotReferenceContext(
  ctx: ProviderContext,
  episodeId: string,
  sceneIndex: number,
) {
  const episode = await ctx.prisma.storyboardEpisode.findUnique({
    where: { id: episodeId },
    select: { projectId: true, title: true, content: true, scenesJson: true },
  });
  if (!episode) throw new Error(`episode not found: ${episodeId}`);
  const rawScenes = Array.isArray(episode.scenesJson) ? episode.scenesJson : [];
  const rawScene = rawScenes.find((item) =>
    item && typeof item === 'object' && (item as Record<string, unknown>).index === sceneIndex,
  );
  const scene = rawScene && typeof rawScene === 'object'
    ? sceneFromStubObject(rawScene as Record<string, unknown>, sceneIndex, episode.title, episode.content)
    : undefined;
  const [characters, itemRows, sceneRows] = await Promise.all([
    ctx.prisma.character.findMany({
      where: { projectId: episode.projectId },
      select: {
        name: true,
        styles: {
          select: { id: true, name: true, prompt: true, assetId: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
    ctx.prisma.item.findMany({
      where: { projectId: episode.projectId },
      select: { id: true, name: true, description: true, prompt: true },
    }),
    ctx.prisma.scene.findMany({
      where: { projectId: episode.projectId },
      select: { id: true, name: true, description: true, prompt: true },
    }),
  ]);
  return { characters, itemRows, sceneRows, scene };
}

async function prepareStubShotSketches(
  ctx: ProviderContext,
  episodeId: string,
  sceneIndex: number,
  shots: Array<{
    id: string;
    displayId: number;
    shotType: string;
    duration: number;
    prompt: string;
    compositionTaskIds: unknown;
    characterStyleIds: unknown;
    sceneIds: unknown;
    itemIds: unknown;
  }>,
): Promise<number> {
  if (shots.length === 0) return 0;
  const episode = await ctx.prisma.storyboardEpisode.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      number: true,
      title: true,
      content: true,
      projectId: true,
      scenesJson: true,
    },
  });
  if (!episode) throw new Error(`episode not found: ${episodeId}`);
  const project = await ctx.prisma.project.findUnique({
    where: { id: episode.projectId },
    select: { id: true, ratio: true, stylePrompt: true, imageModel: true },
  });
  if (!project) throw new Error(`project not found: ${episode.projectId}`);
  const rawScenes = Array.isArray(episode.scenesJson) ? episode.scenesJson : [];
  const rawScene = rawScenes.find((item) =>
    item && typeof item === 'object' && (item as Record<string, unknown>).index === sceneIndex,
  );
  const scene = rawScene && typeof rawScene === 'object'
    ? sceneFromStubObject(rawScene as Record<string, unknown>, sceneIndex, episode.title, episode.content)
    : sceneFromStubObject({}, sceneIndex, episode.title, episode.content);
  const library = await loadStubReferenceLibrary(ctx, project.id);
  const refs = prefillCompositionReferences(scene, library);
  const prompt = buildStubCompositionPrompt(project, scene, refs, library);
  const compositionTask = await ctx.prisma.compositionTask.upsert({
    where: { episodeId_sceneIndex: { episodeId, sceneIndex } },
    create: {
      projectId: project.id,
      episodeId,
      sceneIndex,
      title: `第${episode.number}集 · ${scene.title || `场景 ${sceneIndex + 1}`}`,
      scriptExcerpt: cleanSceneImageSummary(scene.content),
      prompt,
      characterStyleIds: refs.characterStyleIds as never,
      sceneIds: refs.sceneIds as never,
      itemIds: refs.itemIds as never,
    },
    update: {
      title: `第${episode.number}集 · ${scene.title || `场景 ${sceneIndex + 1}`}`,
      scriptExcerpt: cleanSceneImageSummary(scene.content),
      prompt,
      characterStyleIds: refs.characterStyleIds as never,
      sceneIds: refs.sceneIds as never,
      itemIds: refs.itemIds as never,
    },
    include: {
      currentImageRun: {
        include: { taskJob: { include: { assets: true } } },
      },
    },
  });
  const compositionImageAssetId = currentCompositionImageAssetId(compositionTask);
  let preparedCount = 0;
  for (const shot of shots) {
    await prepareShotSketchRun(ctx.prisma, {
      project,
      episode,
      scene,
      shot,
      compositionTask,
      compositionImageAssetId,
    });
    preparedCount += 1;
  }
  return preparedCount;
}
