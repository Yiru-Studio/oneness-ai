import { Hono } from 'hono';
import { zValidator } from '../middleware/validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeCharacter } from '../serializers/character.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateCharacterSchema,
  UpdateCharacterSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';
import { buildResourceImagePrompt } from '@oneness/shared/resource-prompts';

export const characterRoutes = new Hono();

characterRoutes.use('/projects/:id/characters', tryReadUser, requireUser);
characterRoutes.use('/characters/:id', tryReadUser, requireUser);
characterRoutes.use('/characters/:id/analyze', tryReadUser, requireUser);

// GET /projects/:id/characters
characterRoutes.get(
  '/projects/:id/characters',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    const characters = await prisma.character.findMany({
      where: { projectId },
      include: { styles: { include: { asset: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, avatar: true },
      // createdAt alone is unstable: extraction creates many rows in one
      // transaction with identical timestamps. id is the deterministic tiebreaker.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const serialized = await Promise.all(characters.map(serializeCharacter));
    return c.json(serialized);
  },
);

// POST /projects/:id/characters
characterRoutes.post(
  '/projects/:id/characters',
  zValidator('param', IdParamSchema),
  zValidator('json', CreateCharacterSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const body = c.req.valid('json');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    if (body.avatarAssetId) await assertAssetOwned(body.avatarAssetId, user.id);
    const created = await prisma.character.create({
      data: {
        projectId,
        name: body.name,
        description: body.description ?? '',
        bio: body.bio ?? '',
        voice: body.voice ?? null,
        avatarAssetId: body.avatarAssetId ?? null,
        markedBlank: body.markedBlank ?? false,
      },
      include: { styles: { include: { asset: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, avatar: true },
    });
    return c.json(await serializeCharacter(created), 201);
  },
);

// GET /characters/:id
characterRoutes.get(
  '/characters/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const character = await loadOwnedCharacter(id, user.id);
    return c.json(await serializeCharacter(character));
  },
);

// PATCH /characters/:id
characterRoutes.patch(
  '/characters/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateCharacterSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    await loadOwnedCharacter(id, user.id);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.bio !== undefined) data.bio = body.bio;
    if (body.voice !== undefined) data.voice = body.voice;
    if (body.avatarPrompt !== undefined) data.avatarPrompt = body.avatarPrompt;
    if (body.markedBlank !== undefined) data.markedBlank = body.markedBlank;
    if (body.avatarAssetId !== undefined) {
      if (body.avatarAssetId) await assertAssetOwned(body.avatarAssetId, user.id);
      data.avatarAssetId = body.avatarAssetId ?? null;
    }
    const updated = await prisma.character.update({
      where: { id },
      data,
      include: { styles: { include: { asset: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, avatar: true },
    });
    return c.json(await serializeCharacter(updated));
  },
);

// DELETE /characters/:id
characterRoutes.delete(
  '/characters/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    await loadOwnedCharacter(id, user.id);
    await prisma.character.delete({ where: { id } });
    return c.body(null, 204);
  },
);

async function loadOwnedCharacter(id: string, userId: string) {
  const character = await prisma.character.findFirst({
    where: { id, project: { ownerId: userId } },
    include: { styles: { include: { asset: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, avatar: true },
  });
  if (!character) {
    throw AppError.notFound(ErrorCodes.CHARACTER_NOT_FOUND, 'character not found');
  }
  return character;
}

// POST /characters/:id/analyze — LLM-driven character detail + style prompts
characterRoutes.post('/characters/:id/analyze', zValidator('param', IdParamSchema), async (c) => {
  const user = c.var.user!;
  const { id } = c.req.valid('param');

  const character = await prisma.character.findFirst({
    where: { id, project: { ownerId: user.id } },
    include: { project: true, styles: true },
  });
  if (!character) {
    throw AppError.notFound(ErrorCodes.CHARACTER_NOT_FOUND, 'character not found');
  }

  // Gather all episode content from the project.
  const episodes = await prisma.storyboardEpisode.findMany({
    where: { projectId: character.projectId },
    orderBy: { number: 'asc' },
  });
  const scriptText = episodes
    .map((ep) => `第${ep.number}集 — ${ep.title}\n${ep.content || '(无内容)'}`)
    .join('\n\n---\n\n');

  const model = character.project.analysisModel || 'gpt-4o-mini';
  const analysis = await analyzeCharacterWithLLM(
    character.name,
    character.description ?? '',
    scriptText,
    model,
    character.project.stylePrompt ?? '',
  );

  // Update character with description + bio + avatarPrompt.
  await prisma.character.update({
    where: { id: character.id },
    data: {
      description: analysis.description,
      bio: analysis.bio,
      avatarPrompt: analysis.avatarPrompt,
    },
  });

  // Replace style cards with the LLM-suggested looks. We only delete style
  // cards that have not produced an image yet — preserving any look the user
  // already generated. Then we add the freshly inferred looks (2–5 items).
  await prisma.characterStyle.deleteMany({
    where: { characterId: character.id, assetId: null },
  });

  const remainingStyles = await prisma.characterStyle.findMany({
    where: { characterId: character.id },
    select: { name: true },
  });
  const takenNames = new Set(remainingStyles.map((s) => s.name));

  for (const look of analysis.styles) {
    let name = look.name.trim() || '造型';
    // Avoid duplicate names colliding with preserved (image-generated) cards.
    if (takenNames.has(name)) {
      let suffix = 2;
      while (takenNames.has(`${name}${suffix}`)) suffix++;
      name = `${name}${suffix}`;
    }
    takenNames.add(name);

    await prisma.characterStyle.create({
      data: {
        characterId: character.id,
        name,
        prompt: look.prompt,
        model: character.project.imageModel,
        ratio: character.project.ratio,
      },
    });
  }

  // Re-fetch with the freshly-created styles so the response reflects them.
  const fresh = await prisma.character.findUniqueOrThrow({
    where: { id: character.id },
    include: { styles: { include: { asset: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, avatar: true },
  });

  return c.json(await serializeCharacter(fresh), 200);
});

async function assertAssetOwned(assetId: string, userId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ownerId: userId },
    select: { id: true },
  });
  if (!asset) {
    throw AppError.notFound(ErrorCodes.ASSET_NOT_FOUND, 'avatar asset not found');
  }
}

type LLMCharacterAnalysis = {
  description: string;
  bio: string;
  avatarPrompt: string;
  styles: Array<{ name: string; prompt: string }>;
};

async function analyzeCharacterWithLLM(
  characterName: string,
  existingDescription: string,
  scriptText: string,
  model: string,
  projectStylePrompt: string,
): Promise<LLMCharacterAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  if (!apiKey) {
    throw AppError.internal('OPENAI_API_KEY is not configured');
  }

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

  const existingPart = existingDescription.trim()
    ? `已有的角色简介（来自剧本初步提取）：${existingDescription.trim()}\n\n`
    : '';

  const userPrompt = `角色名称：${characterName}

${existingPart}剧本内容：
${scriptText}

${projectStylePrompt ? `项目整体风格指引：${projectStylePrompt}\n\n` : ''}请仔细分析该角色在剧本中出现的不同场景、时间段、身份/职业/状态变化，并返回严格的 JSON 格式，不要包含任何其他文本：
{
  "description": "角色的简短描述（一句话介绍角色身份、地位、外貌特征），可以比已有简介更详细",
  "bio": "角色的背景故事和性格特点（1-2 句话）",
  "avatarPrompt": "用于生成该角色头像/半身像的中文 AI 绘画提示词，需聚焦于：面部特征、五官细节、发型、神态表情、气质氛围、光线；200 字以内。不要包含场景背景。",
  "styles": [
    {
      "name": "造型名称（中文，紧扣剧情场景或身份，例如：年轻时消防员制服造型 / 暖阳回忆训练服造型 / 现代日常居家造型）",
      "prompt": "用于生成该造型全身角色参考图的中文 AI 绘画提示词，需包含：年龄段、外貌特征、发型、服装细节、姿态、神态、干净影棚背景、光线氛围等；不要包含剧情场景、手持独立道具、角色互动；300 字以内"
    }
  ]
}

要求：
1. avatarPrompt 必须生成，专注于面部和上半身特征，适合作为角色头像参考图。
2. styles 数组长度必须在 2 到 5 之间，根据剧本中该角色实际出现的造型变化数量决定，不要凑数。
3. 每个造型必须对应剧本里真实出现的一种状态/场景，不要重复，不要使用「正面/侧面/背面」之类的视角名。
4. prompt 和 avatarPrompt 一律使用中文撰写。`;

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      // Force JSON output so Claude/zenmux can't wrap it in prose or break
      // JSON.parse with unescaped quotes — mirrors the worker's text provider.
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw AppError.internal(
      `LLM HTTP ${res.status}: ${body.slice(0, 500)}`,
      { status: res.status, bodyPreview: body.slice(0, 500), model },
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content ?? '';
  if (!raw.trim()) {
    throw AppError.internal('LLM returned empty content', { model });
  }

  const cleaned = extractJsonObject(raw);
  let parsed: {
    description?: string;
    bio?: string;
    avatarPrompt?: string;
    styles?: Array<{ name?: string; prompt?: string }>;
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw AppError.internal(
      `LLM returned invalid JSON: ${(err as Error).message}`,
      { model, rawPreview: raw.slice(0, 500) },
    );
  }

  const styles = (parsed.styles ?? [])
    .filter((s): s is { name: string; prompt: string } =>
      typeof s.name === 'string' &&
      typeof s.prompt === 'string' &&
      s.name.trim().length > 0 &&
      s.prompt.trim().length > 0,
    )
    .slice(0, 5)
    .map((s) => ({
      name: s.name.trim(),
      prompt: buildResourceImagePrompt({
        kind: 'character-style',
        name: characterName,
        description: parsed.description ?? existingDescription,
        bio: parsed.bio ?? '',
        styleName: s.name,
        userPrompt: s.prompt,
        projectStylePrompt,
      }),
    }));

  // Fallback: if LLM returned fewer than 2 usable looks, pad with generic
  // Chinese prompts so the user still sees something actionable.
  const fallbackNames = ['日常造型', '剧情高光造型'];
  while (styles.length < 2) {
    const idx = styles.length;
    const fallbackName = fallbackNames[idx] ?? `造型${idx + 1}`;
    styles.push({
      name: fallbackName,
      prompt: buildResourceImagePrompt({
        kind: 'character-style',
        name: characterName,
        description: parsed.description ?? existingDescription,
        bio: parsed.bio ?? '',
        styleName: fallbackName,
        userPrompt: `${characterName} 的${fallbackName}全身图：根据剧情设定还原年龄、外貌、发型与服装，姿态自然，光线柔和，单人，简洁背景。`,
        projectStylePrompt,
      }),
    });
  }

  const rawAvatarPrompt = typeof parsed.avatarPrompt === 'string' ? parsed.avatarPrompt.trim() : '';
  const description = typeof parsed.description === 'string' ? parsed.description : '';
  const bio = typeof parsed.bio === 'string' ? parsed.bio : '';

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

/**
 * Strip markdown fences and prose around a JSON object — mirrors the worker's
 * extractJsonObject so Claude/Opus responses that wrap the JSON in ```json …```
 * blocks still parse.
 */
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
