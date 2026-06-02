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
};

export type SceneImageRequiredReferences = {
  characters: string[];
  scenes: string[];
  items: string[];
};

export type SceneImagePlan = {
  sceneIndex: number;
  name: string;
  storyBeat: string;
  scriptExcerpt: string;
  prompt: string;
  requiredReferences: SceneImageRequiredReferences;
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

const SceneImagePlanSchema = z.object({
  sceneIndex: z.coerce.number().int().min(0),
  name: z.string().min(1).max(160),
  storyBeat: z.string().min(1).max(2000),
  scriptExcerpt: z.string().min(1).max(6000),
  prompt: z.string().min(1).max(8000),
  requiredReferences: RequiredReferencesSchema.default({ characters: [], scenes: [], items: [] }),
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

export function referenceLibraryIdSets(library: ReferenceLibraryForPlanning) {
  return {
    characterStyleIds: new Set(library.characters.flatMap((character) => character.styles.map((style) => style.id))),
    sceneIds: new Set(library.scenes.map((scene) => scene.id)),
    itemIds: new Set(library.items.map((item) => item.id)),
  };
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
    '输出 JSON 结构必须是：',
    '{ "plans": [{ "sceneIndex": number, "name": string, "storyBeat": string, "scriptExcerpt": string, "prompt": string, "requiredReferences": { "characters": string[], "scenes": string[], "items": string[] } }] }',
    '',
    '字段要求：',
    '- sceneIndex 从 0 开始，按剧情顺序递增，不能重复。',
    '- name 是简短的中文场景图名称。',
    '- storyBeat 描述这张图覆盖的剧情节点。',
    '- scriptExcerpt 必须是一行中文视觉/剧情短描述，保留 1-3 句核心画面信息；不要复制剧本全文、场次列表或对白长段。',
    '- prompt 是可直接用于生成单张场景图的中文提示词，要求人物、环境、道具自然同框，电影感构图，不能要求九宫格或拼贴。',
    '- requiredReferences 用自然语言列出需要参考的角色、地点/环境、道具名称。',
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
  const characters = uniqueStrings(scene.characters.map((item) => item.trim()));
  const visualDescription = [
    summary,
    scene.environment ? `画面环境应体现${stripSentenceEnd(scene.environment)}。` : '',
  ].filter(Boolean).join(' ');
  return [
    `场景图：${buildSceneImageGoal(sceneTitle, characters)}`,
    `画面描述：${visualDescription}`,
    `构图要求：${buildSceneImageCompositionRules(characters)}`,
    `参考要求：${buildSceneImageReferenceRules(refs, scene, summary)}`,
    `风格要求：${buildSceneImageStyleRules(project)}`,
  ].filter(Boolean).join('\n\n');
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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
