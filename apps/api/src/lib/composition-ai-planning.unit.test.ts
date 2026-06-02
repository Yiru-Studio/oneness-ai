import { describe, expect, it } from 'vitest';
import {
  buildSceneImageCompositionPrompt,
  canRefreshSceneImageTaskDraft,
  cleanSceneImageSummary,
  normalizeSceneImagePlans,
  parseSceneImagePlanResponse,
  parseSceneImageReferenceBindingResponse,
  referenceLibraryIdSets,
  sanitizeReferenceBinding,
  type EpisodeScene,
  type ReferenceLibraryForPlanning,
} from './composition-ai-planning.js';

describe('composition AI planning helpers', () => {
  it('parses and normalizes AI scene image plans', () => {
    const plans = parseSceneImagePlanResponse(`\`\`\`json
{
  "plans": [
    {
      "sceneIndex": 0,
      "name": "雨夜旧照相馆入口",
      "storyBeat": "林沐在雨夜发现照相馆。",
      "scriptExcerpt": "林沐撑伞跑过街口，旧灯牌亮起。",
      "prompt": "电影感雨夜街口，林沐撑蓝色透明雨伞，七格照相馆灯牌亮起。",
      "requiredReferences": {
        "characters": ["林沐"],
        "scenes": ["老城区街口"],
        "items": ["蓝色透明雨伞", "旧相机"]
      }
    },
  ]
}
\`\`\``);

    const fallback: EpisodeScene[] = [{
      index: 99,
      title: 'fallback',
      content: 'fallback content',
      characters: [],
      environment: '',
    }];
    const scenes = normalizeSceneImagePlans(plans, fallback);

    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({
      index: 0,
      title: '雨夜旧照相馆入口',
      content: '林沐撑伞跑过街口，旧灯牌亮起。',
      characters: ['林沐'],
      environment: '老城区街口',
    });
    expect(scenes[0]?.prompt).toContain('电影感雨夜街口');
  });

  it('keeps only the leading short scene summary before pasted script dumps', () => {
    const dirty = [
      '雨夜路口被漫长红灯笼罩，车窗外雨声沙沙，车厢内昏暗安静而逐渐缓和。',
      '《遇见》',
      '1场 小区 夜 外 人物：我 司机',
      '初夏傍晚，闷热潮湿，淅淅沥沥的夜雨落个不停。',
      '2场 马路红绿灯 夜 外 人物：我 司机',
      '车子开到路口，遇上整整七十秒的长红灯，动弹不得。',
    ].join('\n\n');

    expect(cleanSceneImageSummary(dirty)).toBe('雨夜路口被漫长红灯笼罩，车窗外雨声沙沙，车厢内昏暗安静而逐渐缓和。');
  });

  it('keeps already clean short summaries stable', () => {
    const clean = '初夏傍晚，闷热潮湿，夜雨淅淅沥沥地下个不停。我坐上网约车后座，刚上车就感到司机满心烦躁，语气带着不耐。司机叹气说：跑完你这单我就收车，回家。';

    expect(cleanSceneImageSummary(clean)).toBe(clean);
  });

  it('builds composition prompts from the cleaned short summary', () => {
    const prompt = buildSceneImageCompositionPrompt(
      { ratio: '16:9', stylePrompt: 'cinematic lighting' },
      {
        index: 1,
        title: 'INT. 网约车内 / EXT. 路口红绿灯 - 夜',
        content: [
          '雨夜路口被漫长红灯笼罩，车窗外雨声沙沙，车厢内昏暗安静而逐渐缓和。',
          '《遇见》',
          '1场 小区 夜 外 人物：我 司机',
          '初夏傍晚，闷热潮湿，淅淅沥沥的夜雨落个不停。',
        ].join('\n'),
        characters: ['我', '司机'],
        environment: '网约车内、路口红绿灯',
      },
      {
        characterStyleIds: ['style-1'],
        sceneIds: ['scene-1'],
        itemIds: ['item-1'],
        characterStyleLabels: ['司机 · 夜雨驾驶造型', '我 · 后座乘客造型'],
        sceneLabels: ['小区雨夜路口'],
        itemLabels: ['网约车'],
      },
    );

    expect(prompt).toContain('画面描述：雨夜路口被漫长红灯笼罩，车窗外雨声沙沙，车厢内昏暗安静而逐渐缓和。');
    expect(prompt).toContain('构图要求：单张电影剧照');
    expect(prompt).toContain('不要拼贴、分屏、字幕、编号、水印、logo 或说明文字');
    expect(prompt).toContain('参考要求：保持已选角色造型（司机 · 夜雨驾驶造型、我 · 后座乘客造型）的身份、服装、面部和气质一致。');
    expect(prompt).toContain('参考场景素材（小区雨夜路口）用于空间结构、时间氛围和光线关系。');
    expect(prompt).toContain('道具参考（网约车）只在画面需要时自然出现，不要堆砌。');
    expect(prompt).toContain('风格要求：cinematic lighting。画幅比例 16:9。');
    expect(prompt).not.toContain('参考数量');
    expect(prompt).not.toContain('《遇见》');
    expect(prompt).not.toContain('1场 小区');
  });

  it('builds a clear fallback reference rule when no assets are selected', () => {
    const prompt = buildSceneImageCompositionPrompt(
      { ratio: '1:1', stylePrompt: '' },
      {
        index: 0,
        title: '小区门口 - 夜',
        content: '初夏傍晚，夜雨淅淅沥沥地下个不停，乘客刚坐上网约车后座。',
        characters: [],
        environment: '小区门口、雨夜',
      },
      { characterStyleIds: [], sceneIds: [], itemIds: [] },
    );

    expect(prompt).toContain('参考要求：无可用参考素材时，以剧情短描述和项目风格为准，不要额外堆砌未出现的人物或道具。');
    expect(prompt).toContain('风格要求：电影感、真实光影、可作为镜头首帧。画幅比例 1:1。');
    expect(prompt).not.toContain('参考数量');
  });

  it('falls back when AI planning output is unusable', () => {
    const fallback: EpisodeScene[] = [{
      index: 1,
      title: '照相馆内景',
      content: '柜台上放着旧相机。',
      characters: ['周岚'],
      environment: '七格照相馆',
    }];

    const scenes = normalizeSceneImagePlans(parseSceneImagePlanResponse('{"plans": []}'), fallback);

    expect(scenes).toBe(fallback);
  });

  it('drops invalid reference IDs from AI bindings', () => {
    const library: ReferenceLibraryForPlanning = {
      characters: [{
        id: 'char-1',
        name: '林沐',
        description: '高中女生',
        bio: '',
        styles: [
          { id: 'style-valid', name: '雨夜校服造型', prompt: '蓝色校服外套', assetId: 'asset-1' },
        ],
      }],
      scenes: [{ id: 'scene-valid', name: '老城区街口', description: '', prompt: '', assetId: 'asset-2' }],
      items: [{ id: 'item-valid', name: '旧相机', description: '', prompt: '', assetId: 'asset-3' }],
    };
    const [binding] = parseSceneImageReferenceBindingResponse(JSON.stringify({
      bindings: [{
        sceneIndex: 0,
        characterStyleIds: ['style-valid', 'style-invalid'],
        sceneIds: ['scene-invalid', 'scene-valid'],
        itemIds: ['item-valid', 'item-invalid'],
      }],
    }));

    expect(sanitizeReferenceBinding(binding!, referenceLibraryIdSets(library))).toEqual({
      characterStyleIds: ['style-valid'],
      sceneIds: ['scene-valid'],
      itemIds: ['item-valid'],
    });
  });

  it('only refreshes draft tasks that have not generated scene images', () => {
    expect(canRefreshSceneImageTaskDraft({
      status: 'DRAFT',
      currentImageRunId: null,
      imageAssetId: null,
      imageTaskId: null,
    })).toBe(true);

    expect(canRefreshSceneImageTaskDraft({
      status: 'DRAFT',
      currentImageRunId: 'run-1',
      imageAssetId: null,
      imageTaskId: null,
    })).toBe(false);

    expect(canRefreshSceneImageTaskDraft({
      status: 'IMAGE_READY',
      currentImageRunId: null,
      imageAssetId: 'asset-1',
      imageTaskId: 'task-1',
    })).toBe(false);
  });
});
