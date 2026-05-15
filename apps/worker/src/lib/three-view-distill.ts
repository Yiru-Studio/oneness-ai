import { createHash } from 'node:crypto';
import type { Logger } from '@oneness/shared/logger';
import { config } from '../config.js';
import { getOpenAIClient, normalizeOpenAIError } from './openai-client.js';
import { redis } from './redis.js';

/**
 * Strips pose/scene/lighting/film-grain qualifiers out of a "dirty" costume
 * prompt so only identity + wardrobe survives, then caches the result in
 * Redis keyed by the input hash.
 *
 * Why we cache:
 *   The Analyze Character pipeline writes a verbose, scene-mood-laden prompt
 *   onto every CharacterStyle. When the user clicks the 三视图 chip, that
 *   dirty prompt would contaminate the four-panel turnaround (poses, sky
 *   backdrop, film-grain) if we passed it through verbatim. Re-distilling
 *   on every generation would be slow and non-deterministic, so we shard by
 *   sha256(body) and store the cleansed text in Redis forever (no TTL —
 *   content-addressed, idempotent, free to evict under memory pressure).
 *
 * Cache key versioning: bump CACHE_VERSION when the SYSTEM_PROMPT changes
 * so old cleansed strings don't shadow the new behavior.
 */

const CACHE_VERSION = 'v1';
const CACHE_KEY_PREFIX = `three-view-distill:${CACHE_VERSION}:`;

const SYSTEM_PROMPT = [
  'You receive a Chinese description of a character + costume that was',
  'written for a cinematic scene generator. It may include posture,',
  'gestures, scene background, lighting mood, color grading, film-stock',
  'qualifiers, and miscellaneous style tags (e.g. "cinematic lighting",',
  '"shot on 35mm", "masterpiece", "胶片颗粒", "午后阳光").',
  '',
  'Extract ONLY the sentences describing:',
  '  • the character\'s physical traits (age, gender, build, face, hair,',
  '    skin tone, distinguishing features)',
  '  • their clothing / outfit / accessories',
  '',
  'Discard everything else. Specifically discard:',
  '  • poses, gestures, actions, interactions with other people',
  '  • scene / background / location descriptions',
  '  • lighting, color grading, film grain, time-of-day',
  '  • style/quality tags ("cinematic", "movie still", "masterpiece",',
  '    "shot on …", "realistic", trailing English tag lists)',
  '',
  'Return a single clean Chinese paragraph (no bullet points, no preamble,',
  'no markdown). Output ONLY the distilled description.',
].join('\n');

export type DistillResult = {
  cleansed: string;
  cacheHit: boolean;
};

function hashBody(body: string): string {
  return createHash('sha256').update(body.trim(), 'utf8').digest('hex');
}

/**
 * Idempotent: same `body` returns identical `cleansed` for the lifetime of
 * the cache. Errors from the LLM bubble up — the caller decides whether to
 * fall back to the raw body or fail the task.
 */
export async function distillForThreeView(
  body: string,
  log: Logger,
): Promise<DistillResult> {
  const trimmed = body.trim();
  if (!trimmed) {
    return { cleansed: '', cacheHit: false };
  }

  const hash = hashBody(trimmed);
  const key = `${CACHE_KEY_PREFIX}${hash}`;

  const cached = await redis.get(key);
  if (cached !== null) {
    log.info(
      { op: 'three-view-distill', cache: 'hit', hash, bytes: cached.length },
      'three-view distillation cache hit',
    );
    return { cleansed: cached, cacheHit: true };
  }

  const model = config.OPENAI_TEXT_MODEL;
  const client = getOpenAIClient();
  log.info(
    { op: 'three-view-distill', cache: 'miss', hash, model, inputBytes: trimmed.length },
    'three-view distillation cache miss — calling LLM',
  );

  let cleansed: string;
  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: trimmed },
      ],
      temperature: 0,
    });
    const raw = resp.choices[0]?.message?.content ?? '';
    cleansed = raw.trim();
    log.info(
      {
        op: 'three-view-distill',
        cache: 'store',
        hash,
        outputBytes: cleansed.length,
        usage: resp.usage ?? null,
      },
      'three-view distillation produced cleansed body',
    );
  } catch (err) {
    throw normalizeOpenAIError(err);
  }

  if (cleansed.length > 0) {
    await redis.set(key, cleansed);
  }
  return { cleansed, cacheHit: false };
}
