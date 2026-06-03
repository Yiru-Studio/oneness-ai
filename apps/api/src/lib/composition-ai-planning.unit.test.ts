import { describe, expect, it } from 'vitest';
import {
  buildSceneImageCompositionPrompt,
  canRefreshCompositionTaskReferences,
  canRefreshSceneImageTaskDraft,
  cleanSceneImageSummary,
  normalizeSceneImagePlans,
  parseSceneImagePlanResponse,
  parseSceneImageReferenceBindingResponse,
  referenceLibraryIdSets,
  sanitizeReferenceBinding,
  filterReferenceBindingForScene,
  completeReferenceBindingForScene,
  buildSceneImagePlanningMessages,
  buildReferenceBindingMessages,
  prefillCompositionReferences,
  type EpisodeScene,
  type ReferenceLibraryForPlanning,
} from './composition-ai-planning.js';

describe('composition AI planning helpers', () => {
  it('instructs planning to split vehicle interiors from exterior scenes', () => {
    const { userPrompt } = buildSceneImagePlanningMessages({
      project: { ratio: '16:9', stylePrompt: '写实电影感' },
      episode: {
        number: 1,
        title: '遇见',
        content: '小区雨夜，我坐进网约车后座，司机透过后视镜看见我的慌张。',
      },
    });

    expect(userPrompt).toContain('车内、后座、驾驶室');
    expect(userPrompt).toContain('不要被外景场次吞并');
    expect(userPrompt).toContain('INT. 网约车后座 - 夜');
    expect(userPrompt).toContain('外部空间锚点 + 内部空间锚点');
  });

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
      },
      "sceneReferences": {
        "visibleCharacters": ["林沐"],
        "mentionedCharacters": ["周岚"],
        "voiceCharacters": ["电话女声"],
        "backgroundCharacters": [],
        "visibleItems": ["蓝色透明雨伞"],
        "mentionedItems": ["旧相机"],
        "backgroundItems": ["旧灯牌"]
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
    expect(scenes[0]?.sceneReferences).toMatchObject({
      visibleCharacters: ['林沐'],
      mentionedCharacters: ['周岚'],
      voiceCharacters: ['电话女声'],
      visibleItems: ['蓝色透明雨伞'],
      mentionedItems: ['旧相机'],
      backgroundItems: ['旧灯牌'],
    });
  });

  it('tolerates partial LLM sceneReferences output and falls back to required refs', () => {
    const plans = parseSceneImagePlanResponse(JSON.stringify({
      plans: [{
        sceneIndex: '0',
        name: '雨夜车内',
        storyBeat: '我坐进网约车。',
        scriptExcerpt: '我坐进网约车后座，电话里有人说话。',
        prompt: '雨夜网约车内，后座和驾驶室同框。',
        requiredReferences: {
          characters: ['我', '司机', '中年女声'],
          scenes: ['网约车车内'],
          items: ['手机'],
        },
        sceneReferences: {
          visibleCharacters: ['我', '司机'],
          voiceCharacters: ['中年女声'],
        },
      }],
    }));

    const [scene] = normalizeSceneImagePlans(plans, []);

    expect(scene?.sceneReferences).toEqual({
      visibleCharacters: ['我', '司机'],
      mentionedCharacters: [],
      voiceCharacters: ['中年女声'],
      backgroundCharacters: [],
      visibleItems: ['手机'],
      mentionedItems: [],
      backgroundItems: [],
    });
  });

  it('falls back to episode scenes when LLM scene plan output has invalid sceneReferences types', () => {
    const fallback: EpisodeScene[] = [{
      index: 0,
      title: 'fallback',
      content: 'fallback',
      characters: ['我'],
      environment: '车内',
    }];
    const plans = parseSceneImagePlanResponse(JSON.stringify({
      plans: [{
        sceneIndex: 0,
        name: '坏输出',
        storyBeat: '坏输出',
        scriptExcerpt: '坏输出',
        prompt: '坏输出',
        requiredReferences: { characters: ['我'], scenes: ['车内'], items: [] },
        sceneReferences: {
          visibleCharacters: '我',
        },
      }],
    }));

    expect(normalizeSceneImagePlans(plans, fallback)).toBe(fallback);
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
        sceneLabels: ['路口红绿灯'],
        itemLabels: ['网约车'],
      },
    );

    expect(prompt).toContain('画面描述：雨夜路口被漫长红灯笼罩，车窗外雨声沙沙，车厢内昏暗安静而逐渐缓和。');
    expect(prompt).toContain('构图要求：单张电影剧照');
    expect(prompt).toContain('不要拼贴、分屏、字幕、编号、水印、logo 或说明文字');
    expect(prompt).toContain('参考要求：保持已选角色造型（司机 · 夜雨驾驶造型、我 · 后座乘客造型）的身份、服装、面部和气质一致。');
    expect(prompt).toContain('参考场景素材（路口红绿灯）用于空间结构、时间氛围和光线关系。');
    expect(prompt).toContain('道具参考（网约车）只在画面需要时自然出现，不要堆砌。');
    expect(prompt).toContain('风格要求：cinematic lighting。画幅比例 16:9。');
    expect(prompt).not.toContain('参考数量');
    expect(prompt).not.toContain('《遇见》');
    expect(prompt).not.toContain('1场 小区');
  });

  it('filters overly broad historical references from scene image prompts', () => {
    const prompt = buildSceneImageCompositionPrompt(
      { ratio: '16:9', stylePrompt: 'cinematic lighting' },
      {
        index: 0,
        title: '小区 夜 外',
        content: '初夏傍晚，闷热潮湿，夜雨淅淅沥沥地下个不停。我坐上网约车后座，刚上车就感到司机满心烦躁。',
        characters: ['我', '司机'],
        environment: '小区门口被潮湿夜雨笼罩，路灯在雨幕中发黄，车内空气闷热压抑。',
      },
      {
        characterStyleIds: ['style-1', 'style-2', 'style-3'],
        sceneIds: ['scene-1'],
        itemIds: ['item-1', 'item-2', 'item-3'],
        characterStyleLabels: [
          '我 · 高铁站雨夜进站出行造型',
          '司机 · 雨夜网约车司机接单造型',
          '我爷爷 · 抗美援朝年轻夜行军棉军装造型',
          '小战士 · 夜行军志愿军棉服造型',
          '司机爷爷 · 抗美援朝年轻志愿军军装造型',
        ],
        sceneLabels: ['EXT. 小区 - 夜'],
        itemLabels: ['网约车', '手机', '铁锅', '侦察机', '日记本'],
      },
    );

    expect(prompt).toContain('保持已选角色造型（我 · 高铁站雨夜进站出行造型、司机 · 雨夜网约车司机接单造型）');
    expect(prompt).toContain('道具参考（网约车）');
    expect(prompt).not.toContain('我爷爷');
    expect(prompt).not.toContain('小战士');
    expect(prompt).not.toContain('司机爷爷');
    expect(prompt).not.toContain('铁锅');
    expect(prompt).not.toContain('侦察机');
    expect(prompt).not.toContain('日记本');
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

  it('filters AI bindings to visible scene references before saving', () => {
    const library: ReferenceLibraryForPlanning = {
      characters: [
        {
          id: 'char-visible',
          name: '吴一杰',
          description: '可见主角',
          bio: '',
          styles: [{ id: 'style-wu', name: '校服造型', prompt: '校服', assetId: null }],
        },
        {
          id: 'char-voice',
          name: '中年女声',
          description: '电话声音',
          bio: '',
          styles: [{ id: 'style-voice', name: '默认造型', prompt: '中年女性', assetId: null }],
        },
        {
          id: 'char-mentioned',
          name: '闫老师',
          description: '被提及的人',
          bio: '',
          styles: [{ id: 'style-yan', name: '教师造型', prompt: '教师', assetId: null }],
        },
      ],
      scenes: [{ id: 'scene-office', name: '办公室', description: '', prompt: '', assetId: null }],
      items: [
        { id: 'item-phone', name: '手机', description: '', prompt: '', assetId: null },
        { id: 'item-contact-book', name: '通讯本', description: '', prompt: '', assetId: null },
        { id: 'item-papers', name: '试卷', description: '', prompt: '', assetId: null },
      ],
    };
    const scene: EpisodeScene = {
      index: 0,
      title: '电话亭夜戏',
      content: '吴一杰拿着手机听见中年女声提到闫老师。',
      characters: ['吴一杰', '中年女声', '闫老师'],
      environment: '电话亭',
      sceneReferences: {
        visibleCharacters: ['吴一杰'],
        voiceCharacters: ['中年女声'],
        mentionedCharacters: ['闫老师'],
        backgroundCharacters: [],
        visibleItems: ['手机'],
        mentionedItems: ['通讯本'],
        backgroundItems: ['试卷'],
      },
    };
    const binding = {
      sceneIndex: 0,
      characterStyleIds: ['style-wu', 'style-voice', 'style-yan'],
      sceneIds: ['scene-office'],
      itemIds: ['item-phone', 'item-contact-book', 'item-papers'],
    };
    const sanitized = sanitizeReferenceBinding(binding, referenceLibraryIdSets(library));

    expect(filterReferenceBindingForScene(sanitized, scene, library)).toEqual({
      characterStyleIds: ['style-wu'],
      sceneIds: ['scene-office'],
      itemIds: ['item-phone', 'item-papers'],
    });
  });

  it('completes AI bindings with visible matched references without reviving mentioned refs', () => {
    const library: ReferenceLibraryForPlanning = {
      characters: [{
        id: 'char-visible',
        name: '吴一杰',
        description: '可见主角',
        bio: '',
        styles: [{ id: 'style-wu', name: '校服造型', prompt: '校服', assetId: null }],
      }],
      scenes: [{ id: 'scene-rooftop', name: '教学楼天台', description: '', prompt: '', assetId: null }],
      items: [
        { id: 'item-phone', name: '手机', description: '被没收的手机', prompt: '手机参考', assetId: null },
        { id: 'item-membrane', name: '透明薄膜', description: '天台外的异常入口', prompt: '透明薄膜参考', assetId: null },
        { id: 'item-contact-book', name: '通讯本', description: '电话联系用的本子', prompt: '通讯本参考', assetId: null },
      ],
    };
    const scene: EpisodeScene = {
      index: 0,
      title: '天台异常',
      content: '吴一杰看见透明薄膜异常，想起通讯本里的号码。',
      characters: ['吴一杰'],
      environment: '教学楼天台',
      sceneReferences: {
        visibleCharacters: ['吴一杰'],
        voiceCharacters: [],
        mentionedCharacters: [],
        backgroundCharacters: [],
        visibleItems: ['透明薄膜异常'],
        mentionedItems: ['通讯本'],
        backgroundItems: [],
      },
    };

    expect(completeReferenceBindingForScene({
      characterStyleIds: ['style-wu'],
      sceneIds: ['scene-rooftop'],
      itemIds: [],
    }, scene, library)).toEqual({
      characterStyleIds: ['style-wu'],
      sceneIds: ['scene-rooftop'],
      itemIds: ['item-membrane'],
    });
  });

  it('fallback prefill matches items by name, description, or prompt', () => {
    const library: ReferenceLibraryForPlanning = {
      characters: [],
      scenes: [],
      items: [
        {
          id: 'item-phone-name',
          name: '手机',
          description: '黑色智能手机',
          prompt: '手里亮起屏幕的手机',
          assetId: null,
        },
        {
          id: 'item-phone-description',
          name: '通讯设备',
          description: '一部手机，道具描述里才出现关键词',
          prompt: '手机屏幕微光',
          assetId: null,
        },
      ],
    };

    const refs = prefillCompositionReferences({
      index: 0,
      title: '网约车后座',
      content: '我低头看了一眼手机，屏幕上还停留着订单页面。',
      characters: [],
      environment: '车内',
    }, library);

    expect(refs.itemIds).toEqual(['item-phone-name', 'item-phone-description']);
  });

  it('scene reference visibility keeps mentioned and voice-only refs out of fallback prefill', () => {
    const library: ReferenceLibraryForPlanning = {
      characters: [
        { id: 'char-visible', name: '吴一杰', description: '', bio: '', styles: [{ id: 'style-visible', name: '雨夜造型', prompt: '', assetId: null }] },
        { id: 'char-mentioned', name: '池清明', description: '', bio: '', styles: [{ id: 'style-mentioned', name: '回忆造型', prompt: '', assetId: null }] },
        { id: 'char-voice', name: '中年女声', description: '', bio: '', styles: [{ id: 'style-voice', name: '电话造型', prompt: '', assetId: null }] },
      ],
      scenes: [],
      items: [
        { id: 'item-phone', name: '手机', description: '亮起的手机屏幕', prompt: '', assetId: null },
        { id: 'item-basketball', name: '篮球', description: '只在台词中被提到', prompt: '', assetId: null },
      ],
    };

    const refs = prefillCompositionReferences({
      index: 2,
      title: '电话亭 夜',
      content: '吴一杰听见电话里传来中年女声，台词提到池清明和篮球。',
      characters: ['吴一杰', '中年女声', '池清明'],
      environment: '电话亭',
      requiredReferences: { characters: ['吴一杰', '中年女声', '池清明'], scenes: ['电话亭'], items: ['手机', '篮球'] },
      sceneReferences: {
        visibleCharacters: ['吴一杰'],
        mentionedCharacters: ['池清明'],
        voiceCharacters: ['中年女声'],
        backgroundCharacters: [],
        visibleItems: ['手机'],
        mentionedItems: ['篮球'],
        backgroundItems: [],
      },
    }, library);

    expect(refs.characterStyleIds).toEqual(['style-visible']);
    expect(refs.itemIds).toEqual(['item-phone']);
  });

  it('fallback prefill selects one style per matched character and prefers styles with images', () => {
    const library: ReferenceLibraryForPlanning = {
      characters: [
        {
          id: 'char-driver',
          name: '司机',
          description: '中年网约车司机',
          bio: '',
          styles: [
            { id: 'style-driver-default', name: '默认造型', prompt: '普通夹克', assetId: 'asset-driver-default' },
            { id: 'style-driver-driving', name: '雨夜驾驶造型', prompt: '坐在驾驶室，深色外套', assetId: 'asset-driver' },
          ],
        },
        {
          id: 'char-passenger',
          name: '我',
          description: '年轻乘客',
          bio: '',
          styles: [
            { id: 'style-passenger-first', name: '后座造型', prompt: '湿发，浅色上衣', assetId: null },
            { id: 'style-passenger-second', name: '回忆造型', prompt: '童年回忆服装', assetId: null },
          ],
        },
      ],
      scenes: [],
      items: [],
    };

    const refs = prefillCompositionReferences({
      index: 0,
      title: 'INT. 网约车后座 - 夜',
      content: '我坐在后座，司机坐在驾驶室透过后视镜看过来。',
      characters: ['我', '司机'],
      environment: '网约车内',
    }, library);

    expect(refs.characterStyleIds).toEqual(['style-driver-driving', 'style-passenger-first']);
  });

  it('fallback prefill selects character style by phase, outfit, and scene hint metadata', () => {
    const library: ReferenceLibraryForPlanning = {
      characters: [{
        id: 'char-driver',
        name: '司机',
        description: '中年网约车司机',
        bio: '',
        styles: [
          { id: 'style-home', name: '居家造型', prompt: '造型元数据：phase=下班回家；outfit=灰色毛衣；sceneHint=家中\n干净影棚背景', assetId: 'asset-home' },
          { id: 'style-driving', name: '雨夜接单造型', prompt: '造型元数据：phase=雨夜接单；outfit=深色夹克；sceneHint=网约车驾驶室\n干净影棚背景', assetId: null },
        ],
      }],
      scenes: [],
      items: [],
    };

    const refs = prefillCompositionReferences({
      index: 0,
      title: 'INT. 网约车驾驶室 - 夜',
      content: '雨夜接单，司机坐在驾驶室，穿深色夹克。',
      characters: ['司机'],
      environment: '网约车驾驶室',
      sceneReferences: {
        visibleCharacters: ['司机'],
        mentionedCharacters: [],
        voiceCharacters: [],
        backgroundCharacters: [],
        visibleItems: [],
        mentionedItems: [],
        backgroundItems: [],
      },
    }, library);

    expect(refs.characterStyleIds).toEqual(['style-driving']);
  });

  it('fallback prefill matches scenes by scene name or explicit referenceSceneId', () => {
    const library: ReferenceLibraryForPlanning = {
      characters: [],
      scenes: [
        { id: 'scene-car', name: '网约车内', description: '后座和驾驶室', prompt: '', assetId: null },
        { id: 'scene-gate', name: '小区门口', description: '雨夜小区入口', prompt: '', assetId: null },
      ],
      items: [],
    };

    expect(prefillCompositionReferences({
      index: 0,
      title: 'INT. 网约车后座 - 夜',
      content: '车窗外雨声很密。',
      characters: [],
      environment: '网约车内、驾驶室',
      referenceSceneId: 'scene-gate',
    }, library).sceneIds).toEqual(['scene-gate', 'scene-car']);
  });

  it('LLM reference binding prompt includes descriptions and prompts for style-aware matching', () => {
    const library: ReferenceLibraryForPlanning = {
      characters: [{
        id: 'char-driver',
        name: '司机',
        description: '中年网约车司机，疲惫烦躁',
        bio: '后来展现出体贴',
        styles: [
          { id: 'style-driving', name: '雨夜驾驶造型', prompt: '坐在驾驶室，深色夹克，仪表盘冷光', assetId: null },
        ],
      }],
      scenes: [
        { id: 'scene-car', name: '网约车内', description: '后座、驾驶室、后视镜', prompt: '潮湿雨夜车厢', assetId: null },
      ],
      items: [
        { id: 'item-phone', name: '手机', description: '订单页面亮起的手机', prompt: '屏幕微光照亮手指', assetId: null },
      ],
    };

    const { userPrompt } = buildReferenceBindingMessages({
      project: { ratio: '16:9', stylePrompt: '写实电影感' },
      episode: { number: 1, title: '雨夜网约车' },
      scenes: [{
        index: 0,
        title: 'INT. 网约车后座 - 夜',
        content: '我坐进后座，司机透过后视镜观察我。',
        characters: ['我', '司机'],
        environment: '车内、后座、驾驶室',
      }],
      library,
    });

    expect(userPrompt).toContain('style-driving | 角色=司机 | 造型=雨夜驾驶造型 | 坐在驾驶室，深色夹克，仪表盘冷光');
    expect(userPrompt).toContain('scene-car | 网约车内 | 后座、驾驶室、后视镜');
    expect(userPrompt).toContain('item-phone | 手机 | 订单页面亮起的手机');
    expect(userPrompt).toContain('characterStyleIds 选择最符合剧情阶段/服装状态的角色造型');
    expect(userPrompt).toContain('visibleCharacters');
    expect(userPrompt).toContain('voiceCharacters、mentionedCharacters 不应选择人物图');
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

  it('does not refresh composition task references unless new binding refs are provided', () => {
    const draftWithoutImage = {
      status: 'DRAFT',
      currentImageRunId: null,
      imageAssetId: null,
      imageTaskId: null,
    };

    expect(canRefreshCompositionTaskReferences(draftWithoutImage, true)).toBe(true);
    expect(canRefreshCompositionTaskReferences(draftWithoutImage, false)).toBe(false);
    expect(canRefreshCompositionTaskReferences({
      ...draftWithoutImage,
      imageAssetId: 'asset-1',
    }, true)).toBe(false);
  });
});
