/**
 * Manual smoke test for the OpenAI-compatible provider configured via env.
 *
 * Run from repo root:
 *   pnpm --filter worker exec tsx scripts/smoke-openai.ts
 *
 * Reads OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_TEXT_MODEL from .env. It
 * exercises only the chat-completions path (cheap); image-gen costs real
 * money, so we only verify the SDK construction for that path.
 */

import OpenAI from 'openai';
import { config as load } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
load({ path: path.resolve(here, '../../../.env') });

const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL;
const textModel = process.env.OPENAI_TEXT_MODEL ?? 'gpt-4o-mini';
const imageModel = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1';

if (!apiKey) {
  console.error('OPENAI_API_KEY is not set in .env');
  process.exit(1);
}

const client = new OpenAI({ apiKey, baseURL, maxRetries: 0 });

async function probeChat() {
  console.log(
    `[chat] base=${baseURL ?? 'https://api.openai.com/v1'} model=${textModel}`,
  );
  const t0 = Date.now();
  const resp = await client.chat.completions.create({
    model: textModel,
    messages: [
      { role: 'user', content: 'Reply with exactly: PONG (nothing else)' },
    ],
    max_tokens: 10,
  });
  const ms = Date.now() - t0;
  console.log(`[chat] ok in ${ms}ms  id=${resp.id}`);
  console.log(`[chat] content=${JSON.stringify(resp.choices[0]?.message?.content)}`);
  console.log(`[chat] usage=${JSON.stringify(resp.usage)}`);
}

async function probeJsonMode() {
  console.log(`[chat-json] model=${textModel}`);
  const resp = await client.chat.completions.create({
    model: textModel,
    messages: [
      {
        role: 'system',
        content:
          'Respond with JSON: {"summary": string, "keyPoints": string[]}',
      },
      {
        role: 'user',
        content:
          'Episode #1 — Pilot\n\nA cat named Mittens discovers a portal to a parallel world.',
      },
    ],
    response_format: { type: 'json_object' },
  });
  console.log(`[chat-json] raw=${resp.choices[0]?.message?.content}`);
}

async function main() {
  console.log(`[setup] image-model (not called, cost): ${imageModel}`);
  await probeChat();
  await probeJsonMode();
  console.log('[done] OpenAI-compatible provider is reachable.');
}

main().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
