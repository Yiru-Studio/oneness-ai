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
      include: { styles: { include: { asset: true } }, avatar: true },
      orderBy: { createdAt: 'asc' },
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
      include: { styles: { include: { asset: true } }, avatar: true },
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
    if (body.markedBlank !== undefined) data.markedBlank = body.markedBlank;
    if (body.avatarAssetId !== undefined) {
      if (body.avatarAssetId) await assertAssetOwned(body.avatarAssetId, user.id);
      data.avatarAssetId = body.avatarAssetId ?? null;
    }
    const updated = await prisma.character.update({
      where: { id },
      data,
      include: { styles: { include: { asset: true } }, avatar: true },
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
    include: { styles: { include: { asset: true } }, avatar: true },
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

  // Update character with description + bio.
  await prisma.character.update({
    where: { id: character.id },
    data: {
      description: analysis.description,
      bio: analysis.bio,
    },
  });

  // Create 3 default style cards (front / side / back) if they don't exist yet.
  const defaultViews = ['正面', '侧面', '背面'];
  const existingNames = new Set(character.styles.map((s) => s.name));
  for (let i = 0; i < defaultViews.length; i++) {
    const viewName = defaultViews[i];
    if (existingNames.has(viewName)) continue;
    const stylePrompt = analysis.styles[i]?.prompt ?? '';
    await prisma.characterStyle.create({
      data: {
        characterId: character.id,
        name: viewName,
        prompt: stylePrompt,
        model: character.project.imageModel,
        ratio: '9:16',
      },
    });
  }

  // Re-fetch with the freshly-created styles so the response reflects them.
  const fresh = await prisma.character.findUniqueOrThrow({
    where: { id: character.id },
    include: { styles: { include: { asset: true } }, avatar: true },
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
    '基于提供的剧本内容和已有的角色简介，进一步丰富角色的详细信息，并为其生成三个视角（正面、侧面、背面）的AI绘画提示词。' +
    '你必须只输出一个严格合法的JSON对象，不要包含 markdown 代码块、不要包含任何解释文字。';

  const existingPart = existingDescription.trim()
    ? `已有的角色简介（来自剧本初步提取）：${existingDescription.trim()}\n\n`
    : '';

  const userPrompt = `角色名称：${characterName}

${existingPart}剧本内容：
${scriptText}

${projectStylePrompt ? `项目整体风格指引：${projectStylePrompt}\n\n` : ''}请返回严格的JSON格式，不要包含任何其他文本：
{
  "description": "角色的简短描述（一句话介绍角色身份、地位、外貌特征），可以比已有简介更详细",
  "bio": "角色的背景故事和性格特点（1-2句话）",
  "styles": [
    { "name": "正面", "prompt": "用于生成正面全身造型图的英文AI绘画提示词，需包含角色外貌细节、服装、姿态、光线、背景等，300字以内" },
    { "name": "侧面", "prompt": "用于生成侧面全身造型图的英文AI绘画提示词..." },
    { "name": "背面", "prompt": "用于生成背面全身造型图的英文AI绘画提示词..." }
  ]
}`;

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
      typeof s.name === 'string' && typeof s.prompt === 'string',
    )
    .slice(0, 3);

  // Fallback: if LLM didn't return all 3 styles, pad with auto-generated prompts.
  const defaults = ['正面', '侧面', '背面'];
  while (styles.length < 3) {
    const idx = styles.length;
    styles.push({
      name: defaults[idx],
      prompt: `Full-body ${defaults[idx]} view of ${characterName}, detailed character design, clean background, natural lighting.`,
    });
  }

  return {
    description: typeof parsed.description === 'string' ? parsed.description : '',
    bio: typeof parsed.bio === 'string' ? parsed.bio : '',
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
