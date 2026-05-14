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
  try {
    const obj = JSON.parse(raw) as { summary?: unknown; keyPoints?: unknown };
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

function safeParseEntities<T>(raw: string, key: string): T[] {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const arr = obj[key];
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is T => typeof x === 'object' && x !== null);
  } catch {
    return [];
  }
}

export const openaiTextProvider: TextProvider = {
  name: 'openai',

  async analyze(
    input: TextInput,
    ctx: ProviderContext,
  ): Promise<ProviderResult> {
    const client = getOpenAIClient();
    const model = config.OPENAI_TEXT_MODEL;

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
        const resp = await client.chat.completions.create(
          {
            model,
            messages: [
              { role: 'system', content: extractionSystemPrompt(subjectType) },
              { role: 'user', content: userContent },
            ],
            response_format: { type: 'json_object' },
          },
          { signal: ctx.abortSignal },
        );

        const raw = resp.choices[0]?.message?.content ?? '{}';
        const createdIds = await persistExtractedEntities(
          ctx,
          ep.projectId,
          subjectType,
          raw,
        );

        return {
          outputJson: {
            provider: 'openai',
            model,
            episodeId: input.episodeId,
            subjectType,
            createdIds,
            generationId: resp.id ?? null,
            usage: resp.usage ?? null,
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
    const chars = safeParseEntities<ExtractedCharacter>(raw, 'characters')
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
    const items = safeParseEntities<ExtractedItem>(raw, 'items')
      .map((i) => ({ name: String(i.name ?? '').trim() }))
      .filter((i) => i.name.length > 0);
    if (items.length === 0) return [];
    const rows = await ctx.prisma.$transaction(
      items.map((i) => ctx.prisma.item.create({ data: { projectId, name: i.name } })),
    );
    return rows.map((r) => r.id);
  }
  const scenes = safeParseEntities<ExtractedScene>(raw, 'scenes')
    .map((s) => ({ name: String(s.name ?? '').trim() }))
    .filter((s) => s.name.length > 0);
  if (scenes.length === 0) return [];
  const rows = await ctx.prisma.$transaction(
    scenes.map((s) => ctx.prisma.scene.create({ data: { projectId, name: s.name } })),
  );
  return rows.map((r) => r.id);
}
