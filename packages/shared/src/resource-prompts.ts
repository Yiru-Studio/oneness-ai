export type ResourcePromptKind = 'character-avatar' | 'character-style' | 'scene' | 'item';

export type ResourcePromptInput = {
  kind: ResourcePromptKind;
  name: string;
  description?: string | null;
  bio?: string | null;
  styleName?: string | null;
  userPrompt?: string | null;
  projectStylePrompt?: string | null;
  ratio?: string | null;
};

export type ExtractedCharacterInput = {
  name?: unknown;
  description?: unknown;
  bio?: unknown;
  avatarPrompt?: unknown;
};

export type NormalizedCharacter = {
  name: string;
  description: string;
  bio: string;
  avatarPrompt: string;
};

export type ExtractedItemInput = {
  name?: unknown;
  description?: unknown;
  prompt?: unknown;
};

export type NormalizedItem = {
  name: string;
  description: string;
  prompt: string;
};

export type ExtractedSceneInput = {
  name?: unknown;
  description?: unknown;
  prompt?: unknown;
};

export type NormalizedScene = {
  name: string;
  description: string;
  prompt: string;
};

const sentenceSplitPattern = /(?<=[。！？；;，,、])\s*/u;
const characterSceneActionPattern =
  /(场景|背景|街道|房间|室内|户外|门口|窗边|走廊|楼道|储物间|仓库|货架|柜台|收银台|公交站|办公室|教室|咖啡馆|餐厅|码头|船上|江边|水面|球场|赛场|森林|山路|正在|站在|坐在|手里|维修|修理|修好|奔跑|追逐|打球|挥拍|对话|争吵|拥抱|哭泣|寻找|回忆|跳跃|摔倒|远处|身边|旁边|剧情截图)/;
const characterPropPattern =
  /(照片|相机|手机|钥匙|书包|背包|雨伞|信件|信封|纸条|欠条|缴费单|校徽|腕带|铁盒|盒子|螺丝刀|杯子|饮料|豆浆|球拍|网球|篮球|足球|武器|刀|枪|灯|手电|道具)/;
const characterWearablePattern =
  /(穿|戴|佩戴|系着|围着|套着|衣|外套|夹克|衬衫|长裤|裙|鞋|靴|帽|围巾|项链|眼镜|制服|围裙|发型|头发|肤色|体型|身形|脸|五官|眼|鼻|嘴|耳|表情|年龄|男|女|少年|少女|老人|孩子)/;
const heldPropPattern =
  /(拿着|握着|举着|抱着|背着|拎着|携带|手持|递给|放着|取出|掏出|旁边放着|身边放着|口中叼着|叼着|咬着|含着)[^。！？；;，,]*(照片|相机|手机|钥匙|书包|背包|雨伞|信件|信封|纸条|欠条|缴费单|校徽|腕带|铁盒|盒子|螺丝刀|杯子|饮料|豆浆|球拍|网球|篮球|足球|武器|刀|枪|灯|手电|道具)/g;
const wearableCuePattern =
  /(穿|戴|佩戴|系着|围着|套着|衣|外套|夹克|衬衫|长裤|裙|鞋|靴|帽|围巾|项链|眼镜|制服|围裙)/;

const descriptivePrefixPattern =
  /^(?:一把|一张|一封|一枚|一个|一只|一件|几张|几枚|故障|修好(?:的)?|坏掉(?:的)?|发光(?:的)?|手写|黑白|黑色|白色|红色|橙色|黄色|绿色|蓝色|紫色|灰色|银色|金色|米色|棕色|旧|新|旧式|老式|小型|大型|迷你|复古|泛黄|褪色|破损|透明|玻璃|铜|铁|木|纸|布|皮革|橡胶|金属)+/;

const commonPropTerms = [
  '照片',
  '相机',
  '手机',
  '钥匙',
  '书包',
  '背包',
  '雨伞',
  '信件',
  '信封',
  '纸条',
  '欠条',
  '缴费单',
  '校徽',
  '腕带',
  '铁盒',
  '盒子',
  '螺丝刀',
  '杯子',
  '豆浆',
  '灯',
  '手电',
  '球拍',
  '网球',
  '篮球',
  '足球',
  '自行车',
];

const compositeSeparatorPattern = /\s*(?:和|与|及|以及|、|，|,|\/|\+|&)\s*/u;

function text(value: unknown): string {
  return String(value ?? '').replace(/\0/g, '').trim();
}

function compactLines(lines: Array<string | false | null | undefined>): string {
  return lines
    .filter((line): line is string => Boolean(line && line.trim()))
    .map((line) => line.trim())
    .join('\n');
}

function truncate(value: string, max = 4700): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 12).trimEnd()}\n（已截断）`;
}

function sentenceHasIndependentProp(sentence: string): boolean {
  if (!characterPropPattern.test(sentence)) return false;
  if (heldPropPattern.test(sentence)) {
    heldPropPattern.lastIndex = 0;
    return true;
  }
  heldPropPattern.lastIndex = 0;
  return !wearableCuePattern.test(sentence.replace(characterPropPattern, ''));
}

export function cleanCharacterDescriptionForReference(description: string): string {
  const source = text(description);
  if (!source) return '';

  const clauses = source
    .replace(heldPropPattern, '')
    .split(sentenceSplitPattern)
    .map((clause) => clause.replace(/^(并|还|同时|以及|和|与|在|于)/, '').trim())
    .filter(Boolean);
  heldPropPattern.lastIndex = 0;

  const kept = clauses.filter((clause) => {
    if (characterSceneActionPattern.test(clause)) return false;
    if (sentenceHasIndependentProp(clause)) return false;
    return true;
  });
  const fallback =
    clauses.find((clause) => characterWearablePattern.test(clause)) ??
    clauses[0] ??
    source;

  return (kept.length ? kept : [fallback])
    .join('')
    .replace(/[，,、；;]+$/g, '')
    .trim();
}

function cleanName(value: string): string {
  return text(value)
    .replace(/^[《「“"'（(【\[]+|[》」”"')）】\]]+$/g, '')
    .replace(/^(?:把|拿着|拿出|取出|放着|看见|看到|旁边压着|里有|几张|一张|一枚|一个|一只|一把|一封)+/, '')
    .trim();
}

function propCanonicalKey(value: string): string {
  const raw = cleanName(value).replace(/\s+/g, '');
  const withoutPrefix = raw.replace(descriptivePrefixPattern, '');
  const term = commonPropTerms.find((item) => raw.includes(item) || withoutPrefix.includes(item));
  return term ?? withoutPrefix ?? raw;
}

function splitCompositeItemName(value: string): string[] {
  const raw = cleanName(value);
  if (!raw) return [];
  if (!compositeSeparatorPattern.test(raw)) return [raw];
  const parts = raw
    .split(compositeSeparatorPattern)
    .map(cleanName)
    .filter((part) => part.length >= 2 && part.length <= 24);
  return parts.length > 1 ? parts : [raw];
}

function uniqueByName<T extends { name: string }>(items: T[], keyFn: (name: string) => string = (name) => name): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function characterReferenceRules(source: string): string {
  const rules = [
    '角色参考图只画角色本体和固定穿戴；独立道具、剧情动作和具体场景留给道具/场景/合成图片阶段。',
    '固定穿戴可以出现：衣服、制服、围裙、雨衣、围巾、帽子、鞋、眼镜、项链等贴身穿戴。',
    '如果原描述混有动作、场景或独立道具，只提取外形、年龄、体型、五官、发型、服装和固定穿戴。',
  ];
  if (characterPropPattern.test(source)) {
    rules.push('不要画手机、相机、照片、信件、书包、球拍、球、灯具等独立道具；这些应作为单独道具参考图。');
  }
  return rules.join('\n');
}

function alreadyLooksGoverned(kind: ResourcePromptKind, prompt: string): boolean {
  if (!prompt) return false;
  if (kind === 'item') return /单物体道具参考图|唯一主体|只画一个/.test(prompt);
  if (kind === 'scene') return /场景参考图|纯场景|环境结构/.test(prompt);
  return /纯角色参考图|角色参考图只画角色本体|单一角色为唯一主体/.test(prompt);
}

function buildCharacterPrompt(input: ResourcePromptInput): string {
  const rawDescription = compactLines([
    input.description
      ? `描述：${input.description}`
      : input.bio
        ? `描述：${input.bio}`
        : '',
    input.userPrompt ? `补充：${input.userPrompt}` : '',
  ]);
  const referenceDescription =
    cleanCharacterDescriptionForReference(rawDescription) ||
    cleanCharacterDescriptionForReference(input.description ?? '') ||
    text(input.name);
  const isAvatar = input.kind === 'character-avatar';
  const framing = isAvatar
    ? '头像或胸像，正面或 3/4 正面，五官清晰，神态自然。'
    : '全身或中全身，正面或 3/4 正面，静态站姿/坐姿，姿态自然。';

  return truncate(
    compactLines([
      `请生成纯角色参考图。角色名：${text(input.name)}。`,
      input.styleName ? `造型名称：${text(input.styleName)}。` : '',
      `角色设定：${referenceDescription}。`,
      characterReferenceRules(rawDescription),
      '类型：pure character reference，不是剧情截图，不是场面合成图。',
      `要求：单一角色为唯一主体，${framing}身份特征、体型、五官、发型、服装和固定穿戴保持稳定。`,
      '背景：纯白、浅灰、浅色渐变或简洁影棚背景；不要街道、房间、球场、码头、办公室、教室等剧情场景；不要环境道具。',
      '禁止：其他人物、角色互动、手持物、独立道具、剧情动作、复杂背景、文字、水印、logo、边框、拼贴说明文字。',
      input.projectStylePrompt ? `风格：${text(input.projectStylePrompt)}。` : '',
      input.ratio ? `画幅：${text(input.ratio)}。` : '',
    ]),
  );
}

function buildItemPrompt(input: ResourcePromptInput): string {
  const name = text(input.name);
  const supplement = cleanItemPromptSupplement(name, input.userPrompt ?? '');
  const description = text(input.description) || `${name}，剧本中明确出现的关键道具。`;
  return truncate(
    compactLines([
      `请生成单物体道具参考图。道具名：${name}。`,
      `设定：${description}。`,
      '类型：single prop reference / product-style prop reference，不是角色手持画面，也不是剧情截图。',
      `强制主体：只画一个完整的「${name}」，唯一主体，居中展示，外轮廓完整，四周留白。`,
      supplement ? `外观补充（只提取「${name}」本体细节，忽略数量、其他物体、人物和背景）：${supplement}` : '',
      '要求：外观、材质、颜色、尺度和叙事功能清晰；可以轻微投影，但不能出现第二个同类物体。',
      '禁止：两个、多个、一组、一堆、成套、重复、拼贴、并排、挤在一起、被角色拿着、人物、手、身体局部、动物、复杂场景、动作过程、文字、水印、logo、边框。',
      '背景：纯白、浅灰或干净影棚背景。',
      input.projectStylePrompt ? `风格：${text(input.projectStylePrompt)}。` : '',
      input.ratio ? `画幅：${text(input.ratio)}。` : '',
    ]),
  );
}

function cleanItemPromptSupplement(itemName: string, value: string): string {
  const source = text(value);
  if (!source) return '';
  const itemKey = propCanonicalKey(itemName);
  const clauses = source
    .split(sentenceSplitPattern)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const kept = clauses.filter((clause) => {
    if (/(两个|多个|一组|一堆|成套|重复|拼贴|并排|挤在一起|桌面|收银台|柜台|背景|场景|人物|手里|拿着|握着|放在|旁边|身边)/.test(clause)) {
      return false;
    }
    const otherProp = commonPropTerms.some((term) => {
      if (itemName.includes(term) || itemKey.includes(term)) return false;
      return clause.includes(term);
    });
    return !otherProp;
  });
  return kept.join('').slice(0, 500).trim();
}

function buildScenePrompt(input: ResourcePromptInput): string {
  const name = text(input.name);
  return truncate(
    compactLines([
      `请生成场景参考图。场景名：${name}。`,
      input.description ? `场景设定：${text(input.description)}。` : '',
      input.userPrompt ? `补充需求：${text(input.userPrompt)}。` : '',
      '类型：environment reference / establishing shot，不是角色图，不是道具图。',
      '要求：只呈现空间环境本身，环境结构清晰，光线、时间、氛围稳定，可作为后续场面合成的统一场景锚点。',
      '构图：广角或中广角，能看清主要空间关系、入口、动线、关键区域和背景层次。',
      '禁止：人物作为主体、角色肖像、单个道具特写、产品展示、文字、水印、logo、边框、拼贴说明文字。',
      input.projectStylePrompt ? `风格：${text(input.projectStylePrompt)}。` : '',
      input.ratio ? `画幅：${text(input.ratio)}。` : '',
    ]),
  );
}

export function buildResourceImagePrompt(input: ResourcePromptInput): string {
  const userPrompt = text(input.userPrompt);
  if (alreadyLooksGoverned(input.kind, userPrompt)) return truncate(userPrompt);
  if (input.kind === 'item') return buildItemPrompt(input);
  if (input.kind === 'scene') return buildScenePrompt(input);
  return buildCharacterPrompt(input);
}

export function normalizeExtractedCharacters(items: ExtractedCharacterInput[]): NormalizedCharacter[] {
  const normalized = items
    .map((item) => {
      const name = text(item.name);
      const description = cleanCharacterDescriptionForReference(text(item.description));
      const bio = text(item.bio);
      const avatarPrompt = buildResourceImagePrompt({
        kind: 'character-avatar',
        name,
        description,
        bio,
        userPrompt: text(item.avatarPrompt),
      });
      return { name, description: description || text(item.description), bio, avatarPrompt };
    })
    .filter((item) => item.name.length > 0);
  return uniqueByName(normalized);
}

export function normalizeExtractedItems(items: ExtractedItemInput[]): NormalizedItem[] {
  const normalized = items.flatMap((item) => {
    const names = splitCompositeItemName(text(item.name));
    return names.map((name) => {
      const cleanDescription = cleanItemDescription(name, text(item.description));
      const description =
        cleanDescription ||
        `单个「${name}」道具，剧本中明确出现的物件，用于外观和连续性参考。`;
      const prompt = buildResourceImagePrompt({
        kind: 'item',
        name,
        description,
        userPrompt: text(item.prompt),
      });
      return { name, description, prompt };
    });
  });
  return uniqueByName(normalized, propCanonicalKey);
}

function cleanItemDescription(itemName: string, value: string): string {
  const source = text(value);
  if (!source) return '';
  const itemKey = propCanonicalKey(itemName);
  const clauses = source
    .split(sentenceSplitPattern)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const kept = clauses.filter((clause) => {
    if (/(两个|多个|一组|一堆|成套|拼贴|并排|挤在一起|同放|一起放|桌面|收银台|柜台|背景|场景|人物|手里|拿着|握着|旁边|身边)/.test(clause)) {
      return false;
    }
    const otherProp = commonPropTerms.some((term) => {
      if (itemName.includes(term) || itemKey.includes(term)) return false;
      return clause.includes(term);
    });
    return !otherProp;
  });
  return kept.join('').slice(0, 500).trim();
}

export function normalizeExtractedScenes(items: ExtractedSceneInput[]): NormalizedScene[] {
  const normalized = items
    .map((item) => {
      const name = cleanName(text(item.name));
      const description =
        text(item.description) ||
        `${name}，剧本中的连续时间和地点空间，用于环境参考与镜头连续性。`;
      const prompt = buildResourceImagePrompt({
        kind: 'scene',
        name,
        description,
        userPrompt: text(item.prompt),
      });
      return { name, description, prompt };
    })
    .filter((item) => item.name.length > 0);
  return uniqueByName(normalized);
}
