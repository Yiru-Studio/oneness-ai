import OpenAI from 'openai';
import { config } from '../config.js';

let cached: OpenAI | null = null;
let cachedImage: OpenAI | null = null;

/**
 * Lazily build a single OpenAI SDK client from env config.
 * Works against api.openai.com OR any OpenAI-compatible proxy
 * (ZenMux / OpenRouter / DeepSeek / Moonshot / …) by setting
 * OPENAI_BASE_URL.
 *
 * maxRetries=0: we want the worker (BullMQ) to own retry policy,
 * not the SDK. A retry that bypasses our credit reservation logic
 * would double-charge the user.
 */
export function getOpenAIClient(): OpenAI {
  if (cached) return cached;
  if (!config.OPENAI_API_KEY) {
    throw new Error(
      'OPENAI_API_KEY is not set — cannot use the openai provider. ' +
        'Set OPENAI_API_KEY in .env (and OPENAI_BASE_URL for compatible ' +
        'proxies like ZenMux: https://zenmux.ai/api/v1).',
    );
  }
  cached = new OpenAI({
    apiKey: config.OPENAI_API_KEY,
    baseURL: config.OPENAI_BASE_URL,
    maxRetries: 0,
  });
  return cached;
}

export function getOpenAIImageClient(): OpenAI {
  if (cachedImage) return cachedImage;
  const apiKey = config.IMAGE_OPENAI_API_KEY || config.OPENAI_API_KEY;
  const baseURL = config.IMAGE_OPENAI_BASE_URL || config.OPENAI_BASE_URL;
  if (!apiKey) {
    throw new Error(
      'IMAGE_OPENAI_API_KEY or OPENAI_API_KEY is not set — cannot use the ' +
        'openai image provider.',
    );
  }
  cachedImage = new OpenAI({
    apiKey,
    baseURL,
    maxRetries: 0,
  });
  return cachedImage;
}

/**
 * Turn an OpenAI SDK error (or anything else) into a plain Error with a
 * tag that survives into the Task.error column. We keep this lossy on
 * purpose — the structured fields are already logged via ctx.log; the
 * Task.error field is a one-line summary for humans + dashboards.
 *
 * Examples of the tag part:
 *   openai[rate_limit]: ...           (HTTP 429 from ZenMux)
 *   openai[insufficient_credit]: ...  (HTTP 402 from ZenMux)
 *   openai[invalid_params]: ...       (HTTP 400)
 *   openai[http_500]: ...             (fallback when type/code missing)
 *   openai[aborted]                   (cancellation path)
 */
export function normalizeOpenAIError(err: unknown): Error {
  if (err instanceof Error && err.name === 'AbortError') {
    return new Error('openai[aborted]');
  }
  if (err && typeof err === 'object' && 'status' in err && 'message' in err) {
    const e = err as {
      status?: number;
      code?: string;
      type?: string;
      message: string;
    };
    const tag = e.code ?? e.type ?? `http_${e.status ?? 'unknown'}`;
    return new Error(`openai[${tag}]: ${e.message}`);
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}
