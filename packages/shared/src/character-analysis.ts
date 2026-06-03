import { buildResourceImagePrompt } from './resource-prompts.js';

export type LLMCharacterAnalysis = {
  description: string;
  bio: string;
  avatarPrompt: string;
  styles: Array<{ name: string; prompt: string; phase?: string; outfit?: string; sceneHint?: string }>;
};

export type LLMCharacterAnalysisJson = {
  description?: string;
  bio?: string;
  avatarPrompt?: string;
  styles?: Array<{ name?: string; prompt?: string; phase?: string; outfit?: string; sceneHint?: string }>;
};

export function buildCharacterAnalysisMessages(args: {
  characterName: string;
  existingDescription: string;
  scriptText: string;
  projectStylePrompt: string;
}): Array<{ role: 'system' | 'user'; content: string }> {
  const systemPrompt =
    '你是一个专业的剧本角色分析师和造型设计师。' +
    '基于提供的剧本内容和已有的角色简介，进一步丰富角色的详细信息，' +
    '为该角色生成一段用于 AI 绘画的「头像提示词」，' +
    '并结合该角色在剧中可能出现的不同场景、身份、阶段，推断出 2 到 5 个该角色在剧中实际可能出现的造型，' +
    '为每个造型生成一段用于 AI 绘画的中文提示词。' +
    '头像提示词应聚焦于角色的面部特征、发型、神态、气质，适合生成半身像或头像，不要包含剧情场景背景。' +
    '造型的命名要紧扣剧情场景或身份，例如「年轻时消防员制服造型」「暖阳回忆训练服造型」「现代日常居家造型」等，避免使用「正面/侧面/背面」这类视角词。' +
    '造型提示词必须是纯角色参考图，只允许角色本体、服装、发型和固定穿戴，不要把街道、房间、球场等剧情场景或手持独立道具写进去。' +
    '你必须只输出一个严格合法的 JSON 对象，不要包含 markdown 代码块、不要包含任何解释文字。' +
    '字段值内部严禁使用英文双引号(")，如需引用一律改用中文引号「」或单引号，否则 JSON 会解析失败。';

  const existingPart = args.existingDescription.trim()
    ? `已有的角色简介（来自剧本初步提取）：${args.existingDescription.trim()}\n\n`
    : '';

  const userPrompt = `角色名称：${args.characterName}

${existingPart}剧本内容：
${args.scriptText}

${args.projectStylePrompt ? `项目整体风格指引：${args.projectStylePrompt}\n\n` : ''}请仔细分析该角色在剧本中出现的不同场景、时间段、身份/职业/状态变化，并返回严格的 JSON 格式，不要包含任何其他文本：
{
  "description": "角色的简短描述（一句话介绍角色身份、地位、外貌特征），可以比已有简介更详细",
  "bio": "角色的背景故事和性格特点（1-2 句话）",
  "avatarPrompt": "用于生成该角色头像/半身像的中文 AI 绘画提示词，需聚焦于：面部特征、五官细节、发型、神态表情、气质氛围、光线；200 字以内。不要包含场景背景。",
  "styles": [
    {
      "name": "造型名称（中文，紧扣剧情场景或身份，例如：年轻时消防员制服造型 / 暖阳回忆训练服造型 / 现代日常居家造型）",
      "phase": "剧情阶段或时间段，例如：雨夜接单 / 校园回忆 / 天台真相；没有则留空字符串",
      "outfit": "服装/发型/外观关键词，例如：深色夹克、湿发、校服；没有则留空字符串",
      "sceneHint": "最适合引用该造型的场景或空间关键词，例如：网约车后座、办公室、天台；没有则留空字符串",
      "prompt": "用于生成该造型全身角色参考图的中文 AI 绘画提示词，需包含：年龄段、外貌特征、发型、服装细节、姿态、神态、干净影棚背景、光线氛围等；不要包含剧情场景、手持独立道具、角色互动；300 字以内"
    }
  ]
}

要求：
1. avatarPrompt 必须生成，专注于面部和上半身特征，适合作为角色头像参考图。
2. styles 数组长度必须在 2 到 5 之间，根据剧本中该角色实际出现的造型变化数量决定，不要凑数。
3. 每个造型必须对应剧本里真实出现的一种状态/场景，不要重复，不要使用「正面/侧面/背面」之类的视角名。
4. prompt 和 avatarPrompt 一律使用中文撰写。`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function normalizeCharacterAnalysis(args: {
  characterName: string;
  existingDescription: string;
  projectStylePrompt: string;
  parsed: LLMCharacterAnalysisJson;
}): LLMCharacterAnalysis {
  const { characterName, existingDescription, projectStylePrompt, parsed } = args;
  const description = typeof parsed.description === 'string' ? parsed.description : '';
  const bio = typeof parsed.bio === 'string' ? parsed.bio : '';

  const styles = (parsed.styles ?? [])
    .filter((s): s is { name: string; prompt: string; phase?: string; outfit?: string; sceneHint?: string } =>
      typeof s.name === 'string' &&
      typeof s.prompt === 'string' &&
      s.name.trim().length > 0 &&
      s.prompt.trim().length > 0,
    )
    .slice(0, 5)
    .map((s) => ({
      name: s.name.trim(),
      phase: cleanMetadata(s.phase),
      outfit: cleanMetadata(s.outfit),
      sceneHint: cleanMetadata(s.sceneHint),
      prompt: withStyleMetadata(
        buildResourceImagePrompt({
          kind: 'character-style',
          name: characterName,
          description: description || existingDescription,
          bio,
          styleName: s.name,
          userPrompt: s.prompt,
          projectStylePrompt,
        }),
        {
          phase: cleanMetadata(s.phase),
          outfit: cleanMetadata(s.outfit),
          sceneHint: cleanMetadata(s.sceneHint),
        },
      ),
    }));

  const fallbackNames = ['日常造型', '剧情高光造型'];
  while (styles.length < 2) {
    const idx = styles.length;
    const fallbackName = fallbackNames[idx] ?? `造型${idx + 1}`;
    styles.push({
      name: fallbackName,
      phase: '',
      outfit: '',
      sceneHint: '',
      prompt: withStyleMetadata(
        buildResourceImagePrompt({
          kind: 'character-style',
          name: characterName,
          description: description || existingDescription,
          bio,
          styleName: fallbackName,
          userPrompt: `${characterName} 的${fallbackName}全身图：根据剧情设定还原年龄、外貌、发型与服装，姿态自然，光线柔和，单人，简洁背景。`,
          projectStylePrompt,
        }),
        {},
      ),
    });
  }

  const rawAvatarPrompt = typeof parsed.avatarPrompt === 'string' ? parsed.avatarPrompt.trim() : '';
  return {
    description,
    bio,
    avatarPrompt: buildResourceImagePrompt({
      kind: 'character-avatar',
      name: characterName,
      description: description || existingDescription,
      bio,
      userPrompt: rawAvatarPrompt || `${characterName} 的头像：根据剧情设定还原面部特征、发型与神态，正面半身像，光线自然，简洁背景。`,
      projectStylePrompt,
    }),
    styles,
  };
}

function cleanMetadata(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/[；;\n\r]+/g, ' ').slice(0, 120) : '';
}

function withStyleMetadata(
  prompt: string,
  metadata: { phase?: string; outfit?: string; sceneHint?: string },
): string {
  const phase = cleanMetadata(metadata.phase);
  const outfit = cleanMetadata(metadata.outfit);
  const sceneHint = cleanMetadata(metadata.sceneHint);
  if (!phase && !outfit && !sceneHint) return prompt;
  return [
    `造型元数据：phase=${phase || '未指定'}；outfit=${outfit || '未指定'}；sceneHint=${sceneHint || '未指定'}`,
    prompt,
  ].join('\n');
}

export function stripCharacterStyleMetadataForGeneration(prompt: string): string {
  return prompt
    .split('\n')
    .filter((line) => !line.trim().startsWith('造型元数据：'))
    .join('\n')
    .trim();
}

export function parseCharacterAnalysisJson(raw: string): LLMCharacterAnalysisJson {
  const cleaned = extractJsonObject(raw);
  const candidates = buildJsonParseCandidates(cleaned);
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as LLMCharacterAnalysisJson;
    } catch (err) {
      errors.push((err as Error).message);
    }
  }

  const uniqueErrors = [...new Set(errors)];
  throw new Error(uniqueErrors.join('; after repair: '));
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
      if (first !== -1 && last !== -1 && last >= first) {
        return inner.slice(first, last + 1);
      }
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
  const quotedKeys = quoteUnquotedJsonKeys(withoutTrailingCommas);
  const quotedThenTrimmedCommas = removeTrailingCommas(quoteUnquotedJsonKeys(normalized));

  return [
    cleaned,
    normalized,
    withoutTrailingCommas,
    quotedKeys,
    quotedThenTrimmedCommas,
  ].filter((candidate, index, candidates) => candidate && candidates.indexOf(candidate) === index);
}

function removeTrailingCommas(input: string): string {
  let output = '';
  let inString = false;
  let escaping = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inString) {
      output += char;
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === ',') {
      let next = i + 1;
      while (next < input.length && /\s/.test(input[next])) next++;
      if (input[next] === '}' || input[next] === ']') continue;
    }

    output += char;
  }

  return output;
}

function quoteUnquotedJsonKeys(input: string): string {
  let output = '';
  let inString = false;
  let escaping = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inString) {
      output += char;
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char !== '{' && char !== ',') {
      output += char;
      continue;
    }

    output += char;
    let cursor = i + 1;
    while (cursor < input.length && /\s/.test(input[cursor])) {
      output += input[cursor];
      cursor++;
    }

    if (!isUnquotedKeyStart(input[cursor])) {
      i = cursor - 1;
      continue;
    }

    let end = cursor + 1;
    while (end < input.length && isUnquotedKeyChar(input[end])) end++;

    let colon = end;
    while (colon < input.length && /\s/.test(input[colon])) colon++;

    if (input[colon] !== ':') {
      output += input.slice(cursor, end);
      i = end - 1;
      continue;
    }

    output += `"${input.slice(cursor, end)}"`;
    output += input.slice(end, colon + 1);
    i = colon;
  }

  return output;
}

function isUnquotedKeyStart(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z_$\u4e00-\u9fff]/.test(char));
}

function isUnquotedKeyChar(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9_$\-\u4e00-\u9fff]/.test(char));
}
