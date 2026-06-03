import { Hono } from 'hono';
import { zValidator } from '../middleware/validator';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeCharacter } from '../serializers/character.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateCharacterSchema,
  UpdateCharacterSchema,
  IdParamSchema,
} from '@oneness/shared/schemas';
import {
  buildCharacterAnalysisMessages,
  normalizeCharacterAnalysis,
  parseCharacterAnalysisJson,
  type LLMCharacterAnalysis,
  type LLMCharacterAnalysisJson,
} from '@oneness/shared/character-analysis';

export { parseCharacterAnalysisJson } from '@oneness/shared/character-analysis';

export const characterRoutes = new Hono();

const characterInclude = {
  styles: {
    include: {
      asset: true,
      resourceImages: {
        where: { kind: 'character-style' },
        include: { asset: true, task: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  avatar: true,
  resourceImages: {
    where: { kind: 'character-avatar' },
    include: { asset: true, task: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
  },
} satisfies Prisma.CharacterInclude;

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
      include: characterInclude,
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
    if (body.identityAssetId) await assertAssetOwned(body.identityAssetId, user.id);
    const identityAssetId = body.identityAssetId ?? body.avatarAssetId ?? null;
    const created = await prisma.character.create({
      data: {
        projectId,
        name: body.name,
        description: body.description ?? '',
        bio: body.bio ?? '',
        voice: body.voice ?? null,
        avatarAssetId: body.avatarAssetId ?? null,
        identityAssetId,
        markedBlank: body.markedBlank ?? false,
      },
      include: characterInclude,
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
      if (body.identityAssetId === undefined) data.identityAssetId = body.avatarAssetId ?? null;
    }
    if (body.identityAssetId !== undefined) {
      if (body.identityAssetId) await assertAssetOwned(body.identityAssetId, user.id);
      data.identityAssetId = body.identityAssetId ?? null;
    }
    const updated = await prisma.character.update({
      where: { id },
      data,
      include: characterInclude,
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
    include: characterInclude,
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
    include: characterInclude,
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

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: buildCharacterAnalysisMessages({
        characterName,
        existingDescription,
        scriptText,
        projectStylePrompt,
      }),
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

  let parsed: LLMCharacterAnalysisJson;
  try {
    parsed = parseCharacterAnalysisJson(raw);
  } catch (err) {
    throw AppError.internal(
      `LLM returned invalid JSON: ${(err as Error).message}`,
      { model, rawPreview: raw.slice(0, 500) },
    );
  }

  return normalizeCharacterAnalysis({
    characterName,
    existingDescription,
    projectStylePrompt,
    parsed,
  });
}
