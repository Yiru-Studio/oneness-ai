export type ShotReferenceCharacter = {
  name: string;
  styles: Array<{
    id: string;
    assetId: string | null;
    name?: string | null;
    prompt?: string | null;
    phase?: string | null;
    outfit?: string | null;
    sceneHint?: string | null;
  }>;
};

export type ShotReferenceItem = {
  id: string;
  name: string;
  description?: string | null;
  prompt?: string | null;
};

export type ShotReferenceScene = {
  id: string;
  name: string;
  description?: string | null;
  prompt?: string | null;
};

export function resolveShotReferencesFromNames(args: {
  roles: string[];
  items: string[];
  characters: ShotReferenceCharacter[];
  itemRows: ShotReferenceItem[];
  scene?: { title: string; environment: string; content: string };
  sceneRows?: ShotReferenceScene[];
}) {
  const charByName = new Map(args.characters.map((character) => [character.name, character]));
  const itemIdByName = new Map(args.itemRows.map((item) => [item.name, item.id]));
  const sceneHaystack = args.scene
    ? [args.scene.title, args.scene.environment, args.scene.content].join('\n')
    : '';
  const sceneReferenceHaystack = args.scene
    ? [args.scene.title, args.scene.environment].join('\n')
    : '';
  const characterStyleIds: string[] = [];
  for (const role of args.roles) {
    const character = charByName.get(role);
    if (!character) continue;
    const styled = selectBestStyleForShot(sceneHaystack, character.styles);
    if (styled) characterStyleIds.push(styled.id);
  }
  const itemIds = uniqueStrings(args.items.flatMap((name) => {
    const exact = itemIdByName.get(name);
    if (exact) return [exact];
    return args.itemRows
      .filter((item) => referenceTextMatches(name, [], item.name, item.description, item.prompt))
      .map((item) => item.id);
  }));
  const sceneIds = selectMatchingSceneIds(sceneReferenceHaystack, args.sceneRows ?? []);

  return { characterStyleIds, itemIds, sceneIds };
}

function selectBestStyleForShot(
  haystack: string,
  styles: ShotReferenceCharacter['styles'],
) {
  const scored = styles
    .map((style) => ({ style, score: characterStyleScore(haystack, style) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.style ?? styles.find((style) => style.assetId) ?? styles[0];
}

function characterStyleScore(
  haystack: string,
  style: ShotReferenceCharacter['styles'][number],
): number {
  const metadata = characterStyleMetadata(style);
  let score = 0;
  if (metadata.phase && referenceTextMatches(haystack, [], metadata.phase)) score += 8;
  if (metadata.sceneHint && referenceTextMatches(haystack, [], metadata.sceneHint)) score += 6;
  if (metadata.outfit && referenceTextMatches(haystack, [], metadata.outfit)) score += 4;
  if (style.name && referenceTextMatches(haystack, [], style.name)) score += 3;
  if (score === 0 && style.prompt && referenceTextMatches(haystack, [], style.prompt)) score += 1;
  return score;
}

function characterStyleMetadata(style: ShotReferenceCharacter['styles'][number]) {
  const fromPrompt = parseCharacterStyleMetadata(style.prompt ?? '');
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
  const value = match?.[1]?.trim();
  return value && value !== '未指定' ? value : undefined;
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

function selectMatchingSceneIds(haystack: string, scenes: ShotReferenceScene[]): string[] {
  const exactMatches = scenes.filter((scene) => textMentions(haystack, scene.name));
  if (exactMatches.length > 0) return exactMatches.slice(0, 2).map((scene) => scene.id);

  const scored = scenes
    .map((scene) => ({ scene, score: sceneReferenceScore(haystack, scene) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const maxScore = scored[0]?.score ?? 0;
  const strongMatches = scored.filter((item) => item.score >= 8 && item.score >= maxScore - 2);
  if (strongMatches.length > 0) return strongMatches.slice(0, 2).map((item) => item.scene.id);
  return scored[0]?.score && scored[0].score >= 4 ? [scored[0].scene.id] : [];
}

function sceneReferenceScore(haystack: string, scene: ShotReferenceScene): number {
  if (textMentions(haystack, scene.name)) return 20;

  let score = 0;
  for (const value of [scene.name, scene.description, scene.prompt]) {
    for (const phrase of sceneReferencePhrases(value ?? '')) {
      if (!haystack.includes(phrase)) continue;
      if (phrase.length >= 5) score += 8;
      else if (phrase.length === 4) score += 5;
      else if (phrase.length === 3) score += 4;
      else score += 1;
    }
  }
  return score;
}

function sceneReferencePhrases(value: string): string[] {
  const longGrams: string[] = [];
  const tokens = value
    .split(/[^\p{Script=Han}]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const max = Math.min(6, token.length);
    for (let size = max; size >= 3; size -= 1) {
      for (let i = 0; i <= token.length - size; i += 1) {
        const gram = token.slice(i, i + size);
        if (!isGenericReferencePhrase(gram, SCENE_IGNORED_TERMS)) longGrams.push(gram);
      }
    }
  }
  return uniqueStrings([
    ...referencePhrases(value, SCENE_IGNORED_TERMS),
    ...longGrams,
  ]);
}

function textMentions(text: string, term: string): boolean {
  const needle = term.trim();
  if (!needle) return false;
  const haystack = text.trim();
  return haystack.includes(needle) || needle.includes(haystack);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function hasSharedReferencePhrase(left: string, right: string, ignoredTerms: string[]): boolean {
  const leftText = left.trim();
  const rightText = right.trim();
  if (!leftText || !rightText) return false;
  return referencePhrases(rightText, ignoredTerms).some((phrase) => leftText.includes(phrase));
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

const SCENE_IGNORED_TERMS = [
  'INT',
  'EXT',
  '内',
  '外',
  '夜',
  '日',
  '场景',
  '参考',
  '环境',
  '空间',
  '雨夜',
  '夜雨',
  '雨水',
  '雨声',
  '大雨',
  '细雨',
  '湿亮',
  '湿漉漉',
  '灯光',
  '光线',
  '反光',
  '昏暗',
  '压抑',
  '沉静',
  '氛围',
];
