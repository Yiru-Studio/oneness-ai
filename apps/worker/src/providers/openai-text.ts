import type {
  TextProvider,
  TextInput,
  ProviderContext,
  ProviderResult,
} from '@oneness/shared/providers';
import { config } from '../config.js';
import {
  getOpenAIClient,
  normalizeOpenAIError,
} from '../lib/openai-client.js';

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
      '{ "characters": [{ "name": string, "description": string, "bio": string }] }\n' +
      'Use the script\'s native language for the fields. ' +
      'NEVER use double quote characters (") inside any field values — ' +
      'use single quotes (\') or Chinese quotes（"..."）instead. ' +
      '`description` is one short sentence about their role. ' +
      '`bio` is 1–2 sentences on personality/background. ' +
      'No prose outside the JSON object.'
    );
  }
  if (subjectType === 'items') {
    return (
      'You extract notable physical items/props from a storyboard episode. Return JSON exactly:\n' +
      '{ "items": [{ "name": string }] }\n' +
      'Only concrete physical objects that matter to the story. Skip clothing or generic environment. ' +
      'Use the script\'s native language. No prose outside the JSON object.'
    );
  }
  return (
    'You extract distinct scenes from a storyboard episode. A scene is a continuous time/location. Return JSON exactly:\n' +
    '{ "scenes": [{ "name": string }] }\n' +
    'Each `name` is a short scene heading like "INT. 老旧家属楼 - 午后" (or English equivalent). ' +
    'Use the script\'s native language. No prose outside the JSON object.'
  );
}

type ExtractedCharacter = { name: string; description: string; bio: string };
type ExtractedItem = { name: string };
type ExtractedScene = { name: string };

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
            },
            required: ['name', 'description', 'bio'],
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
            },
            required: ['name'],
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
            },
            required: ['name'],
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
      select: { number: true, title: true, content: true, projectId: true },
    });
    if (!ep) throw new Error(`episode not found: ${input.episodeId}`);

    const userContent =
      `Episode #${ep.number} — ${ep.title}\n\n` +
      `${ep.content || '(empty content)'}`;

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
    const chars = safeParseEntities<ExtractedCharacter>(raw, 'characters', ctx.log)
      .map((c) => ({
        name: String(c.name ?? '').trim(),
        description: String(c.description ?? '').trim(),
        bio: String(c.bio ?? '').trim(),
      }))
      .filter((c) => c.name.length > 0);
    if (chars.length === 0) return [];
    const rows = await ctx.prisma.$transaction(
      chars.map((c) =>
        ctx.prisma.character.create({
          data: { projectId, name: c.name, description: c.description, bio: c.bio },
        }),
      ),
    );
    return rows.map((r) => r.id);
  }
  if (subjectType === 'items') {
    const items = safeParseEntities<ExtractedItem>(raw, 'items', ctx.log)
      .map((i) => ({ name: String(i.name ?? '').trim() }))
      .filter((i) => i.name.length > 0);
    if (items.length === 0) return [];
    const rows = await ctx.prisma.$transaction(
      items.map((i) => ctx.prisma.item.create({ data: { projectId, name: i.name } })),
    );
    return rows.map((r) => r.id);
  }
  const scenes = safeParseEntities<ExtractedScene>(raw, 'scenes', ctx.log)
    .map((s) => ({ name: String(s.name ?? '').trim() }))
    .filter((s) => s.name.length > 0);
  if (scenes.length === 0) return [];
  const rows = await ctx.prisma.$transaction(
    scenes.map((s) => ctx.prisma.scene.create({ data: { projectId, name: s.name } })),
  );
  return rows.map((r) => r.id);
}
