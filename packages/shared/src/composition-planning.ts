import { z } from 'zod';

export type EpisodeScene = {
  index: number;
  title: string;
  content: string;
  characters: string[];
  environment: string;
  referenceSceneId?: string;
  prompt?: string;
  requiredReferences?: SceneImageRequiredReferences;
  sceneReferences?: SceneReferenceVisibility;
};

export type SceneImageRequiredReferences = {
  characters: string[];
  scenes: string[];
  items: string[];
};

export type SceneReferenceVisibility = {
  visibleCharacters: string[];
  mentionedCharacters: string[];
  voiceCharacters: string[];
  backgroundCharacters: string[];
  visibleItems: string[];
  mentionedItems: string[];
  backgroundItems: string[];
};

export type SceneImagePlan = {
  sceneIndex: number;
  name: string;
  storyBeat: string;
  scriptExcerpt: string;
  prompt: string;
  requiredReferences: SceneImageRequiredReferences;
  sceneReferences?: SceneReferenceVisibility;
};

export type SceneImageReferenceBinding = {
  sceneIndex: number;
  characterStyleIds: string[];
  sceneIds: string[];
  itemIds: string[];
};

export type SceneImageReferenceIds = {
  characterStyleIds: string[];
  sceneIds: string[];
  itemIds: string[];
};

export type SceneImagePromptReferences = SceneImageReferenceIds & {
  characterStyleLabels?: string[];
  sceneLabels?: string[];
  itemLabels?: string[];
};

export type ReferenceLibraryForPlanning = {
  characters: Array<{
    id: string;
    name: string;
    description: string;
    bio: string;
    styles: Array<{
      id: string;
      name: string;
      prompt: string;
      assetId: string | null;
      phase?: string | null;
      outfit?: string | null;
      sceneHint?: string | null;
    }>;
  }>;
  scenes: Array<{
    id: string;
    name: string;
    description: string;
    prompt: string;
    assetId: string | null;
  }>;
  items: Array<{
    id: string;
    name: string;
    description: string;
    prompt: string;
    assetId: string | null;
  }>;
};

const RequiredReferencesSchema = z.object({
  characters: z.array(z.string()).default([]),
  scenes: z.array(z.string()).default([]),
  items: z.array(z.string()).default([]),
});

const SceneReferenceVisibilitySchema = z.object({
  visibleCharacters: z.array(z.string()).optional(),
  mentionedCharacters: z.array(z.string()).optional(),
  voiceCharacters: z.array(z.string()).optional(),
  backgroundCharacters: z.array(z.string()).optional(),
  visibleItems: z.array(z.string()).optional(),
  mentionedItems: z.array(z.string()).optional(),
  backgroundItems: z.array(z.string()).optional(),
});

const SceneImagePlanSchema = z.object({
  sceneIndex: z.coerce.number().int().min(0),
  name: z.string().min(1).max(160),
  storyBeat: z.string().min(1).max(2000),
  scriptExcerpt: z.string().min(1).max(6000),
  prompt: z.string().min(1).max(8000),
  requiredReferences: RequiredReferencesSchema.default({ characters: [], scenes: [], items: [] }),
  sceneReferences: SceneReferenceVisibilitySchema.optional(),
});

const SceneImageReferenceBindingSchema = z.object({
  sceneIndex: z.coerce.number().int().min(0),
  characterStyleIds: z.array(z.string()).default([]),
  sceneIds: z.array(z.string()).default([]),
  itemIds: z.array(z.string()).default([]),
});

export function parseSceneImagePlanResponse(raw: string): SceneImagePlan[] {
  const obj = parseJsonObject(raw);
  const parsed = z.object({ plans: z.array(SceneImagePlanSchema) }).safeParse(obj);
  return parsed.success ? parsed.data.plans.map(normalizePlan) : [];
}

export function parseSceneImageReferenceBindingResponse(raw: string): SceneImageReferenceBinding[] {
  const obj = parseJsonObject(raw);
  const parsed = z.object({ bindings: z.array(SceneImageReferenceBindingSchema) }).safeParse(obj);
  return parsed.success ? parsed.data.bindings.map(normalizeBinding) : [];
}

export function normalizeSceneImagePlans(
  plans: SceneImagePlan[],
  fallbackScenes: EpisodeScene[],
): EpisodeScene[] {
  const used = new Set<number>();
  const normalized: EpisodeScene[] = [];

  for (const plan of plans) {
    if (used.has(plan.sceneIndex)) continue;
    used.add(plan.sceneIndex);
    const content = cleanSceneImageSummary(plan.scriptExcerpt || plan.storyBeat);
    normalized.push({
      index: plan.sceneIndex,
      title: plan.name.trim(),
      content,
      characters: uniqueStrings(plan.requiredReferences.characters),
      environment: uniqueStrings(plan.requiredReferences.scenes).join('、'),
      prompt: plan.prompt.trim(),
      requiredReferences: {
        characters: uniqueStrings(plan.requiredReferences.characters),
        scenes: uniqueStrings(plan.requiredReferences.scenes),
        items: uniqueStrings(plan.requiredReferences.items),
      },
      sceneReferences: normalizeSceneReferenceVisibility(plan.sceneReferences, plan.requiredReferences),
    });
  }

  return normalized.length > 0 ? normalized : fallbackScenes;
}

export function sanitizeReferenceBinding(
  binding: SceneImageReferenceBinding,
  validIds: {
    characterStyleIds: ReadonlySet<string>;
    sceneIds: ReadonlySet<string>;
    itemIds: ReadonlySet<string>;
  },
): SceneImageReferenceIds {
  return {
    characterStyleIds: uniqueStrings(binding.characterStyleIds).filter((id) => validIds.characterStyleIds.has(id)),
    sceneIds: uniqueStrings(binding.sceneIds).filter((id) => validIds.sceneIds.has(id)),
    itemIds: uniqueStrings(binding.itemIds).filter((id) => validIds.itemIds.has(id)),
  };
}

export function filterReferenceBindingForScene(
  refs: SceneImageReferenceIds,
  scene: EpisodeScene,
  library: ReferenceLibraryForPlanning,
): SceneImageReferenceIds {
  const references = sceneReferenceVisibility(scene);
  const hasExplicitSceneReferences = Boolean(scene.sceneReferences);
  if (!hasExplicitSceneReferences) return refs;

  const visibleCharacters = references.visibleCharacters.length > 0
    ? references.visibleCharacters
    : scene.characters;
  const visualItems = uniqueStrings([...references.visibleItems, ...references.backgroundItems]);
  const visualItemText = visualItems.join('\n');
  return {
    characterStyleIds: refs.characterStyleIds.filter((id) => {
      const character = library.characters.find((item) => item.styles.some((style) => style.id === id));
      if (!character) return false;
      return visibleCharacters.some((name) => textMentions(character.name, name) || textMentions(name, character.name));
    }),
    sceneIds: refs.sceneIds,
    itemIds: refs.itemIds.filter((id) => {
      const item = library.items.find((row) => row.id === id);
      if (!item) return false;
      return (
        visualItems.some((name) => textMentions(item.name, name) || textMentions(name, item.name)) ||
        referenceTextMatches(visualItemText, [], item.name, item.description, item.prompt)
      );
    }),
  };
}

export function completeReferenceBindingForScene(
  refs: SceneImageReferenceIds,
  scene: EpisodeScene,
  library: ReferenceLibraryForPlanning,
): SceneImageReferenceIds {
  const filtered = filterReferenceBindingForScene(refs, scene, library);
  const fallback = filterReferenceBindingForScene(prefillCompositionReferences(scene, library), scene, library);
  return {
    characterStyleIds: uniqueStrings([...filtered.characterStyleIds, ...fallback.characterStyleIds]),
    sceneIds: uniqueStrings([...filtered.sceneIds, ...fallback.sceneIds]),
    itemIds: uniqueStrings([...filtered.itemIds, ...fallback.itemIds]),
  };
}

export function referenceLibraryIdSets(library: ReferenceLibraryForPlanning) {
  return {
    characterStyleIds: new Set(library.characters.flatMap((character) => character.styles.map((style) => style.id))),
    sceneIds: new Set(library.scenes.map((scene) => scene.id)),
    itemIds: new Set(library.items.map((item) => item.id)),
  };
}

export function prefillCompositionReferences(
  scene: EpisodeScene,
  library: ReferenceLibraryForPlanning,
): SceneImageReferenceIds {
  const references = sceneReferenceVisibility(scene);
  const visibleCharacters = references.visibleCharacters.length > 0
    ? references.visibleCharacters
    : scene.characters;
  const hasExplicitSceneReferences = Boolean(scene.sceneReferences);
  const visualItems = hasExplicitSceneReferences
    ? uniqueStrings([...references.visibleItems, ...references.backgroundItems])
    : scene.requiredReferences?.items ?? [];
  const haystack = [
    scene.title,
    hasExplicitSceneReferences ? '' : scene.content,
    scene.environment,
    ...visibleCharacters,
    ...(scene.requiredReferences?.scenes ?? []),
    ...visualItems,
  ].join('\n');
  const ignoredReferenceTerms = library.characters.flatMap((character) => [
    character.name,
    ...visibleCharacters,
  ]);
  const characterStyleIds = library.characters
    .filter((character) => visibleCharacters.some((name) => textMentions(character.name, name) || textMentions(name, character.name)))
    .map((character) => selectBestCharacterStyleForScene(haystack, character)?.id)
    .filter((id): id is string => Boolean(id));
  const sceneIds = library.scenes
    .filter((item) => textMentions(haystack, item.name) || textMentions(item.name, scene.environment))
    .map((item) => item.id);
  if (scene.referenceSceneId && !sceneIds.includes(scene.referenceSceneId)) {
    sceneIds.unshift(scene.referenceSceneId);
  }
  const itemIds = library.items
    .filter((item) => (
      hasExplicitSceneReferences
        ? visualItems.some((name) => textMentions(item.name, name) || textMentions(name, item.name))
        : referenceTextMatches(haystack, ignoredReferenceTerms, item.name, item.description, item.prompt)
    ))
    .map((item) => item.id);
  return { characterStyleIds, sceneIds, itemIds };
}

export function canRefreshSceneImageTaskDraft(existing: {
  status: string;
  currentImageRunId: string | null;
  imageAssetId: string | null;
  imageTaskId: string | null;
}): boolean {
  return (
    existing.status === 'DRAFT' &&
    !existing.currentImageRunId &&
    !existing.imageAssetId &&
    !existing.imageTaskId
  );
}

export function canRefreshCompositionTaskReferences(
  existing: {
    status: string;
    currentImageRunId: string | null;
    imageAssetId: string | null;
    imageTaskId: string | null;
  },
  hasProvidedReferences: boolean,
): boolean {
  return canRefreshSceneImageTaskDraft(existing) && hasProvidedReferences;
}

export function buildSceneImagePlanningMessages(args: {
  project: { ratio: string; stylePrompt: string };
  episode: { number: number; title: string; content: string };
}) {
  const systemPrompt = [
    '你是影视分镜前期的场景图规划师。',
    '你的任务是从剧本中规划需要生成的关键场景图任务。',
    '场景图是用于后续分镜和视频生成的关键合成图，不是九宫格，不是分镜网格。',
    '只输出严格 JSON 对象，不要 markdown，不要解释文字。',
  ].join('\n');

  const userPrompt = [
    `剧集：第${args.episode.number}集 · ${args.episode.title}`,
    `项目比例：${args.project.ratio}`,
    args.project.stylePrompt ? `项目风格：${args.project.stylePrompt}` : '',
    '',
    '请基于下面剧本规划场景图任务。每个连续时间/地点或关键视觉转场可以成为一张场景图。',
    '不要受当前素材库限制，先判断剧情中真正需要哪些场景图。',
    '强视觉空间必须独立成图：车内、后座、驾驶室、驾驶舱、电梯内、车厢内、列车内、房间内等封闭空间一旦承载主要动作/对话/情绪，不要被外景场次吞并。',
    '例如“小区雨夜外景”之后人物坐进网约车后座，应规划“INT. 网约车后座 - 夜”或“网约车车内雨夜”这类独立场景图，而不是只保留“EXT. 小区 - 夜”。',
    '如果同一场次存在外部建立镜头和内部主要戏剧空间，可以拆成两张场景图：外部空间锚点 + 内部空间锚点。',
    '输出 JSON 结构必须是：',
    '{ "plans": [{ "sceneIndex": number, "name": string, "storyBeat": string, "scriptExcerpt": string, "prompt": string, "requiredReferences": { "characters": string[], "scenes": string[], "items": string[] }, "sceneReferences": { "visibleCharacters": string[], "mentionedCharacters": string[], "voiceCharacters": string[], "backgroundCharacters": string[], "visibleItems": string[], "mentionedItems": string[], "backgroundItems": string[] } }] }',
    '',
    '字段要求：',
    '- sceneIndex 从 0 开始，按剧情顺序递增，不能重复。',
    '- name 是简短的中文场景图名称。',
    '- storyBeat 描述这张图覆盖的剧情节点。',
    '- scriptExcerpt 必须是一行中文视觉/剧情短描述，保留 1-3 句核心画面信息；不要复制剧本全文、场次列表或对白长段。',
    '- prompt 是可直接用于生成单张场景图的中文提示词，要求人物、环境、道具自然同框，电影感构图，不能要求九宫格或拼贴。',
    '- requiredReferences 用自然语言列出需要参考的角色、地点/环境、道具名称。',
    '- sceneReferences 必须区分引用可见性：visibleCharacters 是画面中可见/行动的人；voiceCharacters 是只有声音/电话/旁白的人；mentionedCharacters 是只被台词或回忆提到的人；backgroundCharacters 是群演/人群；visibleItems 是画面可见或被使用的关键道具；mentionedItems 是只被提到的物件；backgroundItems 是环境中可见但非动作核心的物件。',
    '- 场景图和后续分镜只会优先引用 visibleCharacters、visibleItems、backgroundItems；不要把 voice/mentioned 内容当成可见参考图。',
    '',
    `剧本：\n${truncateText(args.episode.content, 12000)}`,
  ].filter(Boolean).join('\n');

  return { systemPrompt, userPrompt };
}

export function cleanSceneImageSummary(input: string | null | undefined, fallback = '当前场景关键画面。'): string {
  const source = text(input);
  if (!source) return fallback;
  const normalized = source
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
  const beforeScriptDump = normalized
    .split(/\n\s*(?:《[^》]+》|第?\d+\s*场\b|\d+\s*场\b|INT\.|EXT\.)/iu)[0]
    ?.trim();
  const primary = beforeScriptDump || normalized;
  const compact = primary
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
  const withoutSceneMarkers = compact
    .replace(/《[^》]+》/g, '')
    .replace(/(?:^|\s)第?\d+\s*场\s*[^。！？!?]{0,60}(?=\s|$)/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const withoutLongDialogue = trimDialogueTail(withoutSceneMarkers);
  const sentences = splitChineseSentences(withoutLongDialogue);
  const summary = sentences.slice(0, 3).join('').trim() || withoutLongDialogue || fallback;
  return truncateText(summary.replace(/\s+/g, ' ').trim(), 180);
}

export function buildSceneImageCompositionPrompt(
  project: { stylePrompt: string; ratio: string },
  scene: EpisodeScene,
  refs: SceneImagePromptReferences,
): string {
  const summary = cleanSceneImageSummary(scene.content);
  const sceneTitle = cleanSceneTitle(scene.title);
  const references = sceneReferenceVisibility(scene);
  const characters = uniqueStrings((references.visibleCharacters.length > 0 ? references.visibleCharacters : scene.characters).map((item) => item.trim()));
  const visualDescription = [
    summary,
    scene.environment ? `画面环境应体现${stripSentenceEnd(scene.environment)}。` : '',
    references.voiceCharacters.length > 0 ? `声音角色仅作为画外声处理，不要画成人物：${references.voiceCharacters.join('、')}。` : '',
    references.mentionedCharacters.length > 0 ? `只被提及的角色不要出现在画面中：${references.mentionedCharacters.join('、')}。` : '',
  ].filter(Boolean).join(' ');
  return [
    `场景图：${buildSceneImageGoal(sceneTitle, characters)}`,
    `画面描述：${visualDescription}`,
    `构图要求：${buildSceneImageCompositionRules(characters)}`,
    `参考要求：${buildSceneImageReferenceRules(refs, scene, summary)}`,
    `风格要求：${buildSceneImageStyleRules(project)}`,
  ].filter(Boolean).join('\n\n');
}

export function buildReferenceBindingMessages(args: {
  project: { ratio: string; stylePrompt: string };
  episode: { number: number; title: string };
  scenes: EpisodeScene[];
  library: ReferenceLibraryForPlanning;
}) {
  const systemPrompt = [
    '你是影视 AIGC 素材引用匹配助手。',
    '你的任务是从给定素材库 ID 中，为每张场景图任务选择需要预填充的角色造型、场景素材和道具素材。',
    '只能返回素材库中真实存在的 ID，不能编造 ID。',
    '只输出严格 JSON 对象，不要 markdown，不要解释文字。',
  ].join('\n');

  const userPrompt = [
    `剧集：第${args.episode.number}集 · ${args.episode.title}`,
    `项目比例：${args.project.ratio}`,
    args.project.stylePrompt ? `项目风格：${args.project.stylePrompt}` : '',
    '',
    '场景图任务：',
    JSON.stringify(args.scenes.map((scene) => ({
      sceneIndex: scene.index,
      name: scene.title,
      storyBeat: scene.content,
      prompt: scene.prompt ?? '',
      requiredReferences: scene.requiredReferences ?? { characters: scene.characters, scenes: [scene.environment].filter(Boolean), items: [] },
      sceneReferences: sceneReferenceVisibility(scene),
    })), null, 2),
    '',
    '可选角色造型 ID：',
    formatCharacterStyleOptions(args.library),
    '',
    '可选场景素材 ID：',
    args.library.scenes.map((scene) => (
      `${scene.id} | ${scene.name} | ${truncateText(scene.description || scene.prompt, 260)} | hasImage=${Boolean(scene.assetId)}`
    )).join('\n') || '(无)',
    '',
    '可选道具素材 ID：',
    args.library.items.map((item) => (
      `${item.id} | ${item.name} | ${truncateText(item.description || item.prompt, 260)} | hasImage=${Boolean(item.assetId)}`
    )).join('\n') || '(无)',
    '',
    '输出 JSON 结构必须是：',
    '{ "bindings": [{ "sceneIndex": number, "characterStyleIds": string[], "sceneIds": string[], "itemIds": string[] }] }',
    '',
    '规则：',
    '- 只能使用上面列出的 ID。',
    '- characterStyleIds 选择最符合剧情阶段/服装状态的角色造型。',
    '- sceneIds 选择空间、时间、气氛最匹配的环境素材。',
    '- itemIds 选择剧情中明确出现且影响画面的关键道具。',
    '- 只为 visibleCharacters 选择 characterStyleIds；voiceCharacters、mentionedCharacters 不应选择人物图。',
    '- itemIds 只选择 visibleItems 和必要的 backgroundItems；mentionedItems 不应进入预填充。',
    '- 没有合适素材时返回空数组。',
  ].filter(Boolean).join('\n');

  return { systemPrompt, userPrompt };
}

export async function requestOpenAIJson(args: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  apiKey?: string;
  baseURL?: string;
}): Promise<string> {
  const apiKey = args.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  const baseURL = args.baseURL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: args.model,
      messages: [
        { role: 'system', content: args.systemPrompt },
        { role: 'user', content: args.userPrompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = json.choices?.[0]?.message?.content ?? '';
  if (!raw.trim()) throw new Error('LLM returned empty content');
  return raw;
}

function cleanSceneTitle(title: string): string {
  const cleaned = title
    .replace(/^(?:INT\.\/EXT|EXT\.\/INT|INT|EXT)\.\s*/iu, '')
    .replace(/\s*[-－—]\s*(?:清晨|上午|中午|下午|傍晚|黄昏|夜晚|晚上|深夜|凌晨)\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || title.trim() || '当前关键场景';
}

function buildSceneImageGoal(sceneTitle: string, characters: string[]): string {
  const subject = characters.length > 0 ? `${characters.join('、')}自然同框` : '关键人物与环境自然同框';
  return `${sceneTitle}，${subject}。`;
}

function buildSceneImageCompositionRules(characters: string[]): string {
  const characterRule = characters.length > 0
    ? `让出场人物（${characters.join('、')}）的站位、视线或动作关系清晰可读。`
    : '让画面主体、环境和关键道具关系清晰可读。';
  return [
    '单张电影剧照，不要拼贴、分屏、字幕、编号、水印、logo 或说明文字。',
    characterRule,
    '人物、道具与环境需要自然同框，构图清晰，光线统一，空间层次明确。',
  ].join('');
}

function buildSceneImageReferenceRules(
  refs: SceneImagePromptReferences,
  scene: EpisodeScene,
  summary: string,
): string {
  const haystack = [scene.title, scene.environment, summary].join('\n');
  const characterLabels = relevantCharacterStyleLabels(refs.characterStyleLabels ?? [], scene.characters);
  const sceneLabels = relevantReferenceLabels(refs.sceneLabels ?? [], haystack).slice(0, 2);
  const itemLabels = relevantReferenceLabels(refs.itemLabels ?? [], haystack).slice(0, 4);
  const rules = [
    characterLabels.length > 0
      ? `保持已选角色造型（${characterLabels.join('、')}）的身份、服装、面部和气质一致。`
      : '',
    sceneLabels.length > 0
      ? `参考场景素材（${sceneLabels.join('、')}）用于空间结构、时间氛围和光线关系。`
      : '',
    itemLabels.length > 0
      ? `道具参考（${itemLabels.join('、')}）只在画面需要时自然出现，不要堆砌。`
      : '',
  ].filter(Boolean);
  if (rules.length > 0) return rules.join('');
  return '无可用参考素材时，以剧情短描述和项目风格为准，不要额外堆砌未出现的人物或道具。';
}

function buildSceneImageStyleRules(project: { stylePrompt: string; ratio: string }): string {
  const style = project.stylePrompt.trim();
  return `${style ? `${style}。` : '电影感、真实光影、可作为镜头首帧。'}画幅比例 ${project.ratio}。`;
}

function stripSentenceEnd(value: string): string {
  return value.trim().replace(/[。！？!?]+$/u, '');
}

function relevantCharacterStyleLabels(labels: string[], characters: string[]): string[] {
  const names = uniqueStrings(characters.map((item) => item.trim()));
  const uniqueLabels = uniqueStrings(labels);
  if (names.length === 0) return uniqueLabels.slice(0, 3);
  return uniqueLabels.filter((label) => {
    const owner = label.split(/\s*[·\-－]\s*/u)[0]?.trim() ?? '';
    return names.some((name) => owner === name || label === name);
  });
}

export function normalizeSceneReferenceVisibility(
  value?: Partial<SceneReferenceVisibility> | null,
  fallback?: SceneImageRequiredReferences,
): SceneReferenceVisibility {
  return {
    visibleCharacters: uniqueStrings(referenceField(value, 'visibleCharacters', fallback?.characters ?? [])),
    mentionedCharacters: uniqueStrings(value?.mentionedCharacters ?? []),
    voiceCharacters: uniqueStrings(value?.voiceCharacters ?? []),
    backgroundCharacters: uniqueStrings(value?.backgroundCharacters ?? []),
    visibleItems: uniqueStrings(referenceField(value, 'visibleItems', fallback?.items ?? [])),
    mentionedItems: uniqueStrings(value?.mentionedItems ?? []),
    backgroundItems: uniqueStrings(value?.backgroundItems ?? []),
  };
}

function referenceField(
  value: Partial<SceneReferenceVisibility> | null | undefined,
  key: keyof SceneReferenceVisibility,
  fallback: string[],
): string[] {
  if (!value || !Object.prototype.hasOwnProperty.call(value, key)) return fallback;
  const field = value[key];
  return Array.isArray(field) ? field : [];
}

export function sceneReferenceVisibility(scene: EpisodeScene): SceneReferenceVisibility {
  return normalizeSceneReferenceVisibility(scene.sceneReferences, scene.requiredReferences ?? {
    characters: scene.characters,
    scenes: [scene.environment].filter(Boolean),
    items: [],
  });
}

function relevantReferenceLabels(labels: string[], haystack: string): string[] {
  const normalizedHaystack = normalizeReferenceText(haystack);
  if (!normalizedHaystack) return [];
  return uniqueStrings(labels).filter((label) => {
    const normalizedLabel = normalizeReferenceText(label);
    if (!normalizedLabel) return false;
    if (normalizedHaystack.includes(normalizedLabel)) return true;
    return referenceLabelTokens(label).some((token) => normalizedHaystack.includes(normalizeReferenceText(token)));
  });
}

function referenceLabelTokens(label: string): string[] {
  return uniqueStrings(
    label
      .replace(/\b(?:INT|EXT)\b\.?/giu, ' ')
      .replace(/[()（）【】《》]/gu, ' ')
      .split(/[\s,，、.。:：;；/／|｜\-－—]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !/^(?:内|外|夜|日|白天|清晨|上午|中午|下午|傍晚|黄昏|深夜)$/u.test(token)),
  );
}

function normalizeReferenceText(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

function normalizePlan(plan: z.infer<typeof SceneImagePlanSchema>): SceneImagePlan {
  return {
    sceneIndex: plan.sceneIndex,
    name: plan.name.trim(),
    storyBeat: plan.storyBeat.trim(),
    scriptExcerpt: plan.scriptExcerpt.trim(),
    prompt: plan.prompt.trim(),
    requiredReferences: {
      characters: uniqueStrings(plan.requiredReferences.characters.map((item) => item.trim())),
      scenes: uniqueStrings(plan.requiredReferences.scenes.map((item) => item.trim())),
      items: uniqueStrings(plan.requiredReferences.items.map((item) => item.trim())),
    },
    sceneReferences: normalizeSceneReferenceVisibility(plan.sceneReferences, plan.requiredReferences),
  };
}

function normalizeBinding(binding: z.infer<typeof SceneImageReferenceBindingSchema>): SceneImageReferenceBinding {
  return {
    sceneIndex: binding.sceneIndex,
    characterStyleIds: uniqueStrings(binding.characterStyleIds),
    sceneIds: uniqueStrings(binding.sceneIds),
    itemIds: uniqueStrings(binding.itemIds),
  };
}

function parseJsonObject(raw: string): unknown {
  const cleaned = extractJsonObject(raw);
  const candidates = buildJsonParseCandidates(cleaned);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next repair candidate.
    }
  }
  return {};
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    const lines = trimmed.split('\n');
    const firstFence = lines[0].match(/^```(?:json)?\s*$/i);
    const lastFence = lines[lines.length - 1].match(/^```\s*$/);
    if (firstFence && lastFence) {
      const inner = lines.slice(1, -1).join('\n').trim();
      const first = inner.indexOf('{');
      const last = inner.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last >= first) return inner.slice(first, last + 1);
      return inner;
    }
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return trimmed;
  return trimmed.slice(first, last + 1);
}

function buildJsonParseCandidates(cleaned: string): string[] {
  const normalized = cleaned.trim().replace(/^\uFEFF/, '');
  const withoutTrailingCommas = removeTrailingCommas(normalized);
  return [cleaned, normalized, withoutTrailingCommas]
    .filter((candidate, index, candidates) => candidate && candidates.indexOf(candidate) === index);
}

function removeTrailingCommas(input: string): string {
  let output = '';
  let inString = false;
  let escaping = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inString) {
      output += char;
      if (escaping) escaping = false;
      else if (char === '\\') escaping = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ',') {
      let next = i + 1;
      while (next < input.length && /\s/.test(input[next])) next += 1;
      if (input[next] === '}' || input[next] === ']') continue;
    }
    output += char;
  }
  return output;
}

function trimDialogueTail(input: string): string {
  const dialogueIndex = input.search(/[：:]/u);
  if (dialogueIndex < 0) return input;
  const before = input.slice(0, dialogueIndex);
  const after = input.slice(dialogueIndex + 1);
  if (before.length < 18 && after.length > 20) return input;
  return input;
}

function splitChineseSentences(input: string): string[] {
  const matches = input.match(/[^。！？!?]+[。！？!?]?/gu) ?? [];
  return matches.map((item) => item.trim()).filter(Boolean);
}

function formatCharacterStyleOptions(library: ReferenceLibraryForPlanning): string {
  const rows = library.characters.flatMap((character) => (
    character.styles.map((style) => (
      `${style.id} | 角色=${character.name} | 造型=${style.name} | ${truncateText(style.prompt || character.description || character.bio, 280)} | hasImage=${Boolean(style.assetId)}`
    ))
  ));
  return rows.join('\n') || '(无)';
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function referenceTextMatches(
  haystack: string,
  ignoredTerms: string[],
  ...values: Array<string | null | undefined>
): boolean {
  return values.some((value) => value
    ? textMentions(haystack, value) || hasSharedReferencePhrase(haystack, value, ignoredTerms)
    : false);
}

function selectBestCharacterStyleForScene(
  haystack: string,
  character: ReferenceLibraryForPlanning['characters'][number],
) {
  const scored = character.styles
    .map((style) => ({ style, score: characterStyleSceneScore(haystack, style) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.style ?? character.styles.find((style) => style.assetId) ?? character.styles[0];
}

function characterStyleSceneScore(
  haystack: string,
  style: ReferenceLibraryForPlanning['characters'][number]['styles'][number],
): number {
  const metadata = characterStyleSceneMetadata(style);
  let score = 0;
  if (metadata.phase && referenceTextMatches(haystack, [], metadata.phase)) score += 8;
  if (metadata.sceneHint && referenceTextMatches(haystack, [], metadata.sceneHint)) score += 6;
  if (metadata.outfit && referenceTextMatches(haystack, [], metadata.outfit)) score += 4;
  if (referenceTextMatches(haystack, [], style.name)) score += 3;
  if (score === 0 && referenceTextMatches(haystack, [], style.prompt)) score += 1;
  return score;
}

function characterStyleSceneMetadata(style: {
  name: string;
  prompt: string;
  phase?: string | null;
  outfit?: string | null;
  sceneHint?: string | null;
}) {
  const fromPrompt = parseCharacterStyleMetadata(style.prompt);
  return {
    phase: style.phase ?? fromPrompt.phase,
    outfit: style.outfit ?? fromPrompt.outfit,
    sceneHint: style.sceneHint ?? fromPrompt.sceneHint,
  };
}

function parseCharacterStyleMetadata(prompt: string): { phase?: string; outfit?: string; sceneHint?: string } {
  const metaLine = prompt.split('\n').find((line) => line.trim().startsWith('造型元数据：'));
  if (!metaLine) return {};
  return {
    phase: extractMetadataValue(metaLine, 'phase'),
    outfit: extractMetadataValue(metaLine, 'outfit'),
    sceneHint: extractMetadataValue(metaLine, 'sceneHint'),
  };
}

function extractMetadataValue(line: string, key: string): string | undefined {
  const match = new RegExp(`${key}=([^；;\\n]+)`, 'u').exec(line);
  return match?.[1]?.trim() || undefined;
}

function textMentions(text: string, term: string): boolean {
  const needle = term.trim();
  if (!needle) return false;
  return text.includes(needle) || needle.includes(text.trim());
}

function hasSharedReferencePhrase(left: string, right: string, ignoredTerms: string[]): boolean {
  const leftText = left.trim();
  const rightText = right.trim();
  if (!leftText || !rightText) return false;
  const phrases = referencePhrases(rightText, ignoredTerms);
  return phrases.some((phrase) => leftText.includes(phrase));
}

function referencePhrases(value: string, ignoredTerms: string[]): string[] {
  const direct = value
    .split(/[^\p{Script=Han}\p{Letter}\p{Number}]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !isGenericReferencePhrase(item, ignoredTerms));
  const grams: string[] = [];
  for (const token of direct) {
    if (!/[\p{Script=Han}]/u.test(token)) continue;
    const max = Math.min(6, token.length);
    if (token.length > 10) continue;
    for (let size = max; size >= 2; size -= 1) {
      for (let i = 0; i <= token.length - size; i += 1) {
        const gram = token.slice(i, i + size);
        if (!isGenericReferencePhrase(gram, ignoredTerms)) grams.push(gram);
      }
    }
  }
  return uniqueStrings([...direct, ...grams]);
}

function isGenericReferencePhrase(value: string, ignoredTerms: string[]): boolean {
  if (ignoredTerms.some((term) => term && (term.includes(value) || value.includes(term)))) return true;
  return new Set([
    '一个',
    '一部',
    '一名',
    '一位',
    '道具',
    '场景',
    '角色',
    '画面',
    '参考',
    '出现',
    '使用',
    '手持',
    '日间',
    '夜间',
    '昏色',
    '校园',
    '学校',
    '学生',
    '老师',
    '同学',
    '线索',
    '证据',
    '核心',
    '隐喻',
    '规则',
  ]).has(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
