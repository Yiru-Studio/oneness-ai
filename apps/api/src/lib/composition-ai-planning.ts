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
    normalized.push({
      index: plan.sceneIndex,
      title: plan.name.trim(),
      content: (plan.scriptExcerpt || plan.storyBeat).trim(),
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
    '- scriptExcerpt 摘取相关剧本片段。',
    '- prompt 是可直接用于生成单张场景图的中文提示词，要求人物、环境、道具自然同框，电影感构图，不能要求九宫格或拼贴。',
    '- requiredReferences 用自然语言列出需要参考的角色、地点/环境、道具名称。',
    '',
    `剧本：\n${truncateText(args.episode.content, 12000)}`,
  ].filter(Boolean).join('\n');

  return { systemPrompt, userPrompt };
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
