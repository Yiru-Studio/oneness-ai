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
function systemPrompt(analysisType: 'general' | 'basic'): string {
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

type Parsed = { summary: string; keyPoints: string[] };

function safeParse(raw: string): Parsed {
  try {
    const obj = JSON.parse(raw) as Partial<Parsed>;
    return {
      summary: typeof obj.summary === 'string' ? obj.summary : '',
      keyPoints: Array.isArray(obj.keyPoints)
        ? obj.keyPoints.filter((s): s is string => typeof s === 'string')
        : [],
    };
  } catch {
    // Model ignored the response_format hint. Salvage the raw text as the
    // summary rather than failing the task — analyze is best-effort.
    return { summary: raw, keyPoints: [] };
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
      select: { number: true, title: true, content: true },
    });
    if (!ep) throw new Error(`episode not found: ${input.episodeId}`);

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
            { role: 'system', content: systemPrompt(input.analysisType) },
            {
              role: 'user',
              content:
                `Episode #${ep.number} — ${ep.title}\n\n` +
                `${ep.content || '(empty content)'}`,
            },
          ],
          response_format: { type: 'json_object' },
        },
        { signal: ctx.abortSignal },
      );

      const raw = resp.choices[0]?.message?.content ?? '{}';
      const parsed = safeParse(raw);

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
