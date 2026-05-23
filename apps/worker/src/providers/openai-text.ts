import { Prisma } from '@prisma/client';
import type {
  TextProvider,
  TextInput,
  ProviderContext,
  ProviderResult,
} from '@oneness/shared/providers';
import type OpenAI from 'openai';
import { config } from '../config.js';
import {
  getOpenAIClient,
  normalizeOpenAIError,
} from '../lib/openai-client.js';
import {
  normalizeExtractedCharacters,
  normalizeExtractedItems,
  normalizeExtractedScenes,
} from '@oneness/shared/resource-prompts';

/**
 * System prompt scaled to the requested analysis depth. Both modes ask for
 * a strict JSON shape so we can `JSON.parse` safely; `response_format:
 * {type:'json_object'}` makes most OpenAI-compatible providers respect it.
 */
function analysisSystemPrompt(analysisType: 'general' | 'basic'): string {
  const shape =
    'Respond with a single JSON object exactly of this shape:\n' +
    '{ "summary": string, "keyPoints": string[] }\n' +
    'No prose outside the JSON object.';
  if (analysisType === 'basic') {
    return (
      'You are a concise storyboard analyst. Given one storyboard episode, ' +
      'produce a one-sentence summary and 2–3 short key points.\n\n' +
      shape
    );
  }
  return (
    'You are a thorough storyboard analyst. Given one storyboard episode, ' +
    'produce a 2–4 sentence summary capturing plot, mood, and pacing, ' +
    'plus 4–6 specific key points (characters, conflicts, beats).\n\n' +
    shape
  );
}

function extractionSystemPrompt(
  subjectType: 'characters' | 'items' | 'scenes',
): string {
  if (subjectType === 'characters') {
    return (
      'You extract characters from a storyboard episode. Return JSON exactly:\n' +
      '{ "characters": [{ "name": string, "description": string, "bio": string, "avatarPrompt": string }] }\n' +
      'Use the script\'s native language for the fields. ' +
      'NEVER use double quote characters (") inside any field values — ' +
      'use single quotes (\') or Chinese quotes（"..."）instead. ' +
      '`description` is one short sentence about identity, age, appearance, and role. ' +
      '`bio` is 1–2 sentences on personality/background. ' +
      '`avatarPrompt` is a clean pure-character portrait prompt: face, hair, body type, fixed clothing, temperament only. ' +
      'Do not put locations, plot actions, hand-held props, or scene backgrounds into character fields. ' +
      'No prose outside the JSON object.'
    );
  }
  if (subjectType === 'items') {
    return (
      'You extract notable physical items/props from a storyboard episode. Return JSON exactly:\n' +
      '{ "items": [{ "name": string, "description": string, "prompt": string }] }\n' +
      'Only concrete physical objects that matter to the story. Skip clothing, body parts, and generic environment. ' +
      'Each item must be one standalone object. Split composite names like A and B into separate items. ' +
      '`description` should describe one object only: appearance, material, color, and narrative function. ' +
      '`prompt` should be a single-object prop reference prompt with a clean studio background. ' +
      'Use the script\'s native language. No prose outside the JSON object.'
    );
  }
  return (
    'You extract distinct scenes from a storyboard episode. A scene is a continuous time/location. Return JSON exactly:\n' +
    '{ "scenes": [{ "name": string, "description": string, "prompt": string }] }\n' +
    'Each `name` is a short scene heading like "INT. 老旧家属楼 - 午后" (or English equivalent). ' +
    '`description` is one concise sentence describing the physical environment, lighting, time, and mood. ' +
    '`prompt` should be an environment-only scene reference prompt. Do not make a character or prop the subject. ' +
    'Use the script\'s native language. No prose outside the JSON object.'
  );
}

type ExtractedCharacter = { name: string; description: string; bio: string; avatarPrompt?: string };
type ExtractedItem = { name: string; description?: string; prompt?: string };
type ExtractedScene = { name: string; description?: string; prompt?: string };

function safeParseAnalysis(raw: string): { summary: string; keyPoints: string[] } {
  const cleaned = extractJsonObject(raw);
  try {
    const obj = JSON.parse(cleaned) as { summary?: unknown; keyPoints?: unknown };
    return {
      summary: typeof obj.summary === 'string' ? obj.summary : '',
      keyPoints: Array.isArray(obj.keyPoints)
        ? obj.keyPoints.filter((s): s is string => typeof s === 'string')
        : [],
    };
  } catch {
    return { summary: raw, keyPoints: [] };
  }
}

function safeParseEntities<T>(raw: string, key: string, log?: { warn: (obj: Record<string, unknown>, msg: string) => void }): T[] {
  const cleaned = extractJsonObject(raw);
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const arr = obj[key];
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is T => typeof x === 'object' && x !== null);
  } catch (err) {
    log?.warn(
      { key, rawPreview: raw.slice(0, 500), error: (err as Error).message },
      'safeParseEntities JSON.parse failed',
    );
    return [];
  }
}

/**
 * Strip common LLM wrappers around JSON: markdown fences (```json…```),
 * leading prose, trailing prose. We greedily take the substring from the
 * first '{' to the last '}'. If neither is found, returns the original.
 *
 * Real-world failures this fixes:
 *  - Claude sometimes prefixes 'Here is the JSON:\n```json\n{...}\n```'
 *  - zenmux routing may drop the response_format hint so we can't rely on
 *    raw being a pure JSON string.
 */
function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();

  // If the text starts with a markdown fence, strip the first and last
  // fence lines.  Line-based stripping is more reliable than a single
  // regex when the JSON payload itself may contain backticks.
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

// ── JSON Schemas for structured extraction (json_schema response_format) ──

const EXTRACTION_SCHEMAS: Record<
  'characters' | 'items' | 'scenes',
  { name: string; strict: boolean; schema: Record<string, unknown> }
> = {
  characters: {
    name: 'character_extraction',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        characters: {
          type: 'array',
          description: 'Characters extracted from the episode',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Character name' },
              description: {
                type: 'string',
                description: 'One short sentence about their role',
              },
              bio: {
                type: 'string',
                description: '1-2 sentences on personality/background',
              },
              avatarPrompt: {
                type: 'string',
                description: 'Clean pure-character portrait prompt without scene/action/props',
              },
            },
            required: ['name', 'description', 'bio', 'avatarPrompt'],
            additionalProperties: false,
          },
        },
      },
      required: ['characters'],
      additionalProperties: false,
    },
  },
  items: {
    name: 'item_extraction',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Notable physical items/props extracted from the episode',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Item name' },
              description: {
                type: 'string',
                description: 'One standalone prop only: appearance, material, color, and narrative function',
              },
              prompt: {
                type: 'string',
                description: 'Single-object clean prop reference prompt',
              },
            },
            required: ['name', 'description', 'prompt'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  scenes: {
    name: 'scene_extraction',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        scenes: {
          type: 'array',
          description: 'Distinct scenes extracted from the episode',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Scene heading / name' },
              description: {
                type: 'string',
                description: 'Physical environment, lighting, time, and mood',
              },
              prompt: {
                type: 'string',
                description: 'Environment-only scene reference prompt',
              },
            },
            required: ['name', 'description', 'prompt'],
            additionalProperties: false,
          },
        },
      },
      required: ['scenes'],
      additionalProperties: false,
    },
  },
};

function isSchemaUnsupportedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; message?: string; code?: string; type?: string };
  if (e.status !== 400) return false;
  const msg = (e.message ?? '').toLowerCase();
  return (
    msg.includes('json_schema') ||
    msg.includes('output_config') ||
    msg.includes('schema') ||
    msg.includes('response_format') ||
    msg.includes('extra inputs')
  );
}

export const openaiTextProvider: TextProvider = {
  name: 'openai',

  async analyze(
    input: TextInput,
    ctx: ProviderContext,
  ): Promise<ProviderResult> {
    const client = getOpenAIClient();
    const model = input.model || config.OPENAI_TEXT_MODEL;

    const ep = await ctx.prisma.storyboardEpisode.findUnique({
      where: { id: input.episodeId },
      select: { number: true, title: true, content: true, projectId: true, scenesJson: true },
    });
    if (!ep) throw new Error(`episode not found: ${input.episodeId}`);

    const userContent =
      `Episode #${ep.number} — ${ep.title}\n\n` +
      `${ep.content || '(empty content)'}`;

    // ── Storyboard "分析剧集": episode → scene breakdown ──
    if ('analysisType' in input && input.analysisType === 'scene_list') {
      return analyzeSceneList({ client, model, ep, episodeId: input.episodeId, ctx });
    }

    // ── AI-assist "智能分镜创作": one scene → shot list ──
    if ('analysisType' in input && input.analysisType === 'shot_breakdown') {
      return analyzeShotBreakdown({
        client,
        model,
        ep,
        episodeId: input.episodeId,
        sceneIndex: input.sceneIndex,
        ctx,
      });
    }

    if ('subjectType' in input) {
      const { subjectType } = input;
      ctx.log.info(
        {
          provider: 'openai',
          op: 'extract',
          model,
          episodeId: input.episodeId,
          subjectType,
        },
        'openai text extract start',
      );

      try {
        const messages = [
          { role: 'system' as const, content: extractionSystemPrompt(subjectType) },
          { role: 'user' as const, content: userContent },
        ];

        // Try json_schema first for strict structured output.
        // Fall back to json_object when the provider/model does not support
        // json_schema (e.g. Claude Opus 4.7 through ZenMux's OpenAI path).
        let resp;
        let usedSchema = true;
        try {
          resp = await client.chat.completions.create(
            {
              model,
              messages,
              response_format: {
                type: 'json_schema',
                json_schema: EXTRACTION_SCHEMAS[subjectType],
              },
            },
            { signal: ctx.abortSignal },
          );
        } catch (err) {
          if (isSchemaUnsupportedError(err)) {
            ctx.log.warn(
              { provider: 'openai', model, subjectType, error: (err as Error).message },
              'json_schema unsupported, falling back to json_object',
            );
            resp = await client.chat.completions.create(
              {
                model,
                messages,
                response_format: { type: 'json_object' },
              },
              { signal: ctx.abortSignal },
            );
            usedSchema = false;
          } else {
            throw err;
          }
        }

        const raw = resp.choices[0]?.message?.content ?? '{}';
        const createdIds = await persistExtractedEntities(
          ctx,
          ep.projectId,
          subjectType,
          raw,
        );
        if (createdIds.length === 0) {
          ctx.log.warn(
            { provider: 'openai', op: 'extract', subjectType, usedSchema, rawPreview: raw.slice(0, 800) },
            'entity extraction produced 0 rows',
          );
        }

        return {
          outputJson: {
            provider: 'openai',
            model,
            episodeId: input.episodeId,
            subjectType,
            createdIds,
            generationId: resp.id ?? null,
            usage: resp.usage ?? null,
            usedSchema,
          },
        };
      } catch (err) {
        throw normalizeOpenAIError(err);
      }
    }

    ctx.log.info(
      {
        provider: 'openai',
        op: 'analyze',
        model,
        episodeId: input.episodeId,
        analysisType: input.analysisType,
      },
      'openai text analyze start',
    );

    try {
      const resp = await client.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: analysisSystemPrompt(input.analysisType) },
            { role: 'user', content: userContent },
          ],
          response_format: { type: 'json_object' },
        },
        { signal: ctx.abortSignal },
      );

      const raw = resp.choices[0]?.message?.content ?? '{}';
      const parsed = safeParseAnalysis(raw);

      return {
        outputJson: {
          provider: 'openai',
          model,
          analysisType: input.analysisType,
          episodeId: input.episodeId,
          summary: parsed.summary,
          keyPoints: parsed.keyPoints,
          generationId: resp.id ?? null,
          usage: resp.usage ?? null,
        },
      };
    } catch (err) {
      throw normalizeOpenAIError(err);
    }
  },
};

async function persistExtractedEntities(
  ctx: ProviderContext,
  projectId: string,
  subjectType: 'characters' | 'items' | 'scenes',
  raw: string,
): Promise<string[]> {
  if (subjectType === 'characters') {
    const chars = normalizeExtractedCharacters(
      safeParseEntities<ExtractedCharacter>(raw, 'characters', ctx.log),
    );
    if (chars.length === 0) return [];
    const rows = await ctx.prisma.$transaction(
      chars.map((c) =>
        ctx.prisma.character.create({
          data: {
            projectId,
            name: c.name,
            description: c.description,
            bio: c.bio,
            avatarPrompt: c.avatarPrompt,
          },
        }),
      ),
    );
    return rows.map((r) => r.id);
  }
  if (subjectType === 'items') {
    const items = normalizeExtractedItems(
      safeParseEntities<ExtractedItem>(raw, 'items', ctx.log),
    );
    if (items.length === 0) return [];
    const rows = await ctx.prisma.$transaction(
      items.map((i) =>
        ctx.prisma.item.create({
          data: {
            projectId,
            name: i.name,
            description: i.description,
            prompt: i.prompt,
          },
        }),
      ),
    );
    return rows.map((r) => r.id);
  }
  const scenes = normalizeExtractedScenes(
    safeParseEntities<ExtractedScene>(raw, 'scenes', ctx.log),
  );
  if (scenes.length === 0) return [];
  const rows = await ctx.prisma.$transaction(
    scenes.map((s) =>
      ctx.prisma.scene.create({
        data: {
          projectId,
          name: s.name,
          description: s.description,
          prompt: s.prompt,
        },
      }),
    ),
  );
  return rows.map((r) => r.id);
}

// ──────────────────────────────────────────────────────────────────────────
// Storyboard "分析剧集": episode → scene breakdown (summary + scenes[])
// ──────────────────────────────────────────────────────────────────────────

type EpisodeRow = {
  number: number;
  title: string;
  content: string;
  projectId: string;
  scenesJson: unknown;
};

type AnalyzedScene = {
  index: number;
  title: string;
  content: string;
  characters: string[];
  environment: string;
};

function sceneListSystemPrompt(): string {
  return [
    'You are a professional film script breakdown assistant for an AI storyboard tool.',
    'Given one episode script, split it into its distinct SCENES — each a continuous',
    'location + time block, usually marked by a scene heading. Also write a 2–4 sentence',
    'episode summary.',
    '',
    'Return a single JSON object EXACTLY of this shape:',
    '{ "summary": string, "scenes": [{ "title": string, "content": string, "characters": string[], "environment": string }] }',
    '',
    'Rules:',
    "- Use the script's native language for every field (Chinese in → Chinese out).",
    '- `title` = the scene heading (location + 日/夜 + 内/外), short.',
    '- `content` = the script text for that scene: keep short scenes close to verbatim; for long scenes, condense to the key action beats + important dialogue (a few sentences). Stay concrete — this drives shot generation.',
    '- `characters` = names of characters who appear or speak in the scene.',
    '- `environment` = one vivid sentence describing the physical setting for image/video generation (lighting, space, mood).',
    '- Identify up to 24 of the most important scenes, in story order. Merge trivially short fragments into a neighbour.',
    '- NEVER use double-quote characters (") inside field values; use single quotes or 「」 instead.',
    '- No prose outside the JSON object.',
  ].join('\n');
}

function safeParseSceneList(raw: string): {
  summary: string;
  scenes: Array<{ title: string; content: string; characters: string[]; environment: string }>;
} {
  const cleaned = extractJsonObject(raw);
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const scenesRaw = Array.isArray(obj.scenes) ? obj.scenes : [];
    const scenes = scenesRaw
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s) => ({
        title: String(s.title ?? '').trim(),
        content: String(s.content ?? '').trim(),
        characters: Array.isArray(s.characters)
          ? s.characters.filter((x): x is string => typeof x === 'string').map((x) => x.trim())
          : [],
        environment: String(s.environment ?? '').trim(),
      }))
      .filter((s) => s.title.length > 0 || s.content.length > 0);
    return { summary: typeof obj.summary === 'string' ? obj.summary : '', scenes };
  } catch {
    return { summary: '', scenes: [] };
  }
}

async function analyzeSceneList(args: {
  client: OpenAI;
  model: string;
  ep: EpisodeRow;
  episodeId: string;
  ctx: ProviderContext;
}): Promise<ProviderResult> {
  const { client, model, ep, episodeId, ctx } = args;
  ctx.log.info({ provider: 'openai', op: 'scene_list', model, episodeId }, 'scene-list analyze start');
  try {
    const resp = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: sceneListSystemPrompt() },
          {
            role: 'user',
            content: `剧集 #${ep.number} — ${ep.title}\n\n${ep.content || '(empty content)'}`,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 16000,
      },
      { signal: ctx.abortSignal },
    );

    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed = safeParseSceneList(raw);
    const scenes: AnalyzedScene[] = parsed.scenes.map((s, i) => ({ index: i, ...s }));

    if (scenes.length === 0) {
      ctx.log.warn(
        { provider: 'openai', op: 'scene_list', rawPreview: raw.slice(0, 800) },
        'scene-list produced 0 scenes',
      );
    }

    await ctx.prisma.storyboardEpisode.update({
      where: { id: episodeId },
      data: {
        summary: parsed.summary,
        scenesJson: scenes as unknown as Prisma.InputJsonValue,
        analyzed: true,
      },
    });

    return {
      outputJson: {
        provider: 'openai',
        model,
        analysisType: 'scene_list',
        episodeId,
        summary: parsed.summary,
        sceneCount: scenes.length,
        generationId: resp.id ?? null,
        usage: resp.usage ?? null,
      },
    };
  } catch (err) {
    throw normalizeOpenAIError(err);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// AI-assist "智能分镜创作": one scene → shot list (auto-fills Shot rows)
// ──────────────────────────────────────────────────────────────────────────

type AnalyzedShot = {
  shotType: 'new' | 'continue';
  duration: number;
  prompt: string;
  roles: string[];
  items: string[];
};

function shotBreakdownSystemPrompt(stylePrompt: string): string {
  return [
    'You are a professional AI film storyboard director. Given ONE scene, break it into a',
    'sequence of video shots (镜头). Each shot becomes one AI-generated video clip.',
    '',
    'Return a single JSON object EXACTLY of this shape:',
    '{ "shots": [{ "shotType": "new" | "continue", "duration": number, "prompt": string, "roles": string[], "items": string[] }] }',
    '',
    "Write each `prompt` (camera description) in the script's native language following:",
    '景别 + 运镜方式 + 视角 + 画面内容及运动方式 + 效果提示词（光影/色调/构图/细节）。若有台词或音效，附在末尾。',
    '',
    'Rules:',
    `- Honour the project visual style: ${stylePrompt || 'cinematic, realistic'}.`,
    '- Produce 6 to 12 shots, in story order. Each `duration` is an integer 3–8 (seconds).',
    '- The first shot must be "new". Use "continue" only when the shot flows seamlessly from the previous one (same action/camera continuation).',
    '- `roles` = character names that appear in the shot (reuse names from the scene). `items` = notable props.',
    '- The AI video model has real-human face-consistency limits: PREFER wide / medium / environment / over-the-shoulder / silhouette / stylized compositions. AVOID extreme facial close-ups of real humans.',
    '- NEVER use double-quote characters (") inside field values; use single quotes or 「」 instead.',
    '- No prose outside the JSON object.',
  ].join('\n');
}

function safeParseShots(raw: string): AnalyzedShot[] {
  const cleaned = extractJsonObject(raw);
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const arr = Array.isArray(obj.shots) ? obj.shots : [];
    return arr
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s) => ({
        shotType: s.shotType === 'continue' ? ('continue' as const) : ('new' as const),
        duration: clampInt(Number(s.duration), 3, 8, 4),
        prompt: String(s.prompt ?? '').trim(),
        roles: Array.isArray(s.roles)
          ? s.roles.filter((x): x is string => typeof x === 'string').map((x) => x.trim())
          : [],
        items: Array.isArray(s.items)
          ? s.items.filter((x): x is string => typeof x === 'string').map((x) => x.trim())
          : [],
      }))
      .filter((s) => s.prompt.length > 0);
  } catch {
    return [];
  }
}

function clampInt(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

async function analyzeShotBreakdown(args: {
  client: OpenAI;
  model: string;
  ep: EpisodeRow;
  episodeId: string;
  sceneIndex: number;
  ctx: ProviderContext;
}): Promise<ProviderResult> {
  const { client, model, ep, episodeId, sceneIndex, ctx } = args;

  const scenes = Array.isArray(ep.scenesJson) ? (ep.scenesJson as AnalyzedScene[]) : [];
  const scene = scenes.find((s) => s.index === sceneIndex) ?? scenes[sceneIndex];
  if (!scene) {
    throw new Error(`scene ${sceneIndex} not found on episode ${episodeId}; run 分析剧集 first`);
  }

  const project = await ctx.prisma.project.findUnique({
    where: { id: ep.projectId },
    select: { ratio: true, stylePrompt: true },
  });
  const ratio = project?.ratio || '16:9';

  ctx.log.info(
    { provider: 'openai', op: 'shot_breakdown', model, episodeId, sceneIndex, sceneTitle: scene.title },
    'shot-breakdown analyze start',
  );

  let shots: AnalyzedShot[];
  try {
    const resp = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: shotBreakdownSystemPrompt(project?.stylePrompt ?? '') },
          {
            role: 'user',
            content:
              `场景标题：${scene.title}\n` +
              `出场角色：${scene.characters.join('、') || '（未知）'}\n` +
              `环境：${scene.environment}\n\n` +
              `剧本内容：\n${scene.content || '(empty)'}`,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 8000,
      },
      { signal: ctx.abortSignal },
    );
    const raw = resp.choices[0]?.message?.content ?? '{}';
    shots = safeParseShots(raw);
    if (shots.length === 0) {
      ctx.log.warn(
        { provider: 'openai', op: 'shot_breakdown', rawPreview: raw.slice(0, 800) },
        'shot-breakdown produced 0 shots',
      );
    }
  } catch (err) {
    throw normalizeOpenAIError(err);
  }

  // Resolve role/item names to existing project assets (best-effort).
  const chars = await ctx.prisma.character.findMany({
    where: { projectId: ep.projectId },
    select: { name: true, styles: { select: { id: true, assetId: true }, orderBy: { createdAt: 'asc' } } },
  });
  const charByName = new Map(chars.map((c) => [c.name, c]));
  const items = await ctx.prisma.item.findMany({
    where: { projectId: ep.projectId },
    select: { id: true, name: true },
  });
  const itemIdByName = new Map(items.map((i) => [i.name, i.id]));

  const createdIds = await ctx.prisma.$transaction(
    async (tx) => {
      // Re-running AI-assist for a scene replaces its previously generated shots,
      // leaving any manually created shots untouched.
      await tx.shot.deleteMany({ where: { episodeId, sceneIndex, createType: 'assist' } });
      const agg = await tx.shot.aggregate({ where: { episodeId }, _max: { displayId: true } });
      let displayId = agg._max.displayId ?? 0;
      let prevDisplayId: number | null = null;
      const ids: string[] = [];

      for (const s of shots) {
        displayId += 1;
        const isContinue = s.shotType === 'continue' && prevDisplayId !== null;

        const characterStyleIds: string[] = [];
        for (const role of s.roles) {
          const c = charByName.get(role);
          if (!c) continue;
          const styled = c.styles.find((st) => st.assetId) ?? c.styles[0];
          if (styled) characterStyleIds.push(styled.id);
        }
        const itemIds = s.items
          .map((n) => itemIdByName.get(n))
          .filter((x): x is string => typeof x === 'string');

        const row = await tx.shot.create({
          data: {
            episodeId,
            displayId,
            sceneIndex,
            shotType: isContinue ? 'continuation' : 'new',
            preId: isContinue ? prevDisplayId : null,
            duration: s.duration,
            prompt: s.prompt,
            model: 'seedance',
            ratio,
            resolution: '720p',
            generateAudio: true,
            createType: 'assist',
            roleNames: s.roles as unknown as Prisma.InputJsonValue,
            characterStyleIds: characterStyleIds as unknown as Prisma.InputJsonValue,
            itemIds: itemIds as unknown as Prisma.InputJsonValue,
            sceneIds: [] as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        ids.push(row.id);
        prevDisplayId = displayId;
      }
      return ids;
    },
    { timeout: 30000 },
  );

  return {
    outputJson: {
      provider: 'openai',
      model,
      analysisType: 'shot_breakdown',
      episodeId,
      sceneIndex,
      shotCount: createdIds.length,
      createdShotIds: createdIds,
    },
  };
}
