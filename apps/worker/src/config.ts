import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET_TASK_OUTPUTS: z.string().default('task-outputs'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PROVIDER_IMAGE: z.string().default('stub'),
  PROVIDER_VIDEO: z.string().default('stub'),
  PROVIDER_TEXT: z.string().default('stub'),
  STUB_FAIL_RATE: z.coerce.number().min(0).max(1).default(0.05),
  IMAGE_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),

  // Shared by every OpenAI-compatible backend (api.openai.com, ZenMux,
  // OpenRouter, DeepSeek, Moonshot, …). Switch backends by changing
  // OPENAI_BASE_URL + OPENAI_API_KEY only.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  // Per-task input.model wins if non-empty; these are the env-level fallbacks.
  // For ZenMux-style proxies, set namespaced names (e.g. 'openai/gpt-4o-mini').
  OPENAI_TEXT_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-2'),

  // ZenMux's Vertex-AI-compatible path is separate from /v1/images and is
  // used by the `nanobanana` provider (Google Gemini image models).
  // Falls back to OPENAI_API_KEY when ZENMUX_API_KEY is not set, since the
  // .env in this repo currently points OPENAI_BASE_URL at zenmux anyway.
  ZENMUX_API_KEY: z.string().optional(),
  ZENMUX_VERTEX_BASE_URL: z
    .string()
    .url()
    .default('https://zenmux.ai/api/vertex-ai'),
  NANOBANANA_MODEL: z.string().default('google/gemini-2.5-flash-image'),

  // Volcengine Ark (Doubao Seedance) — used by seedance / seedance-fast.
  // Key is required at call time, not at boot, so dev without a key still
  // runs (only seedance routes will error if invoked).
  ARK_API_KEY: z.string().optional(),
  ARK_BASE_URL: z
    .string()
    .url()
    .default('https://ark.cn-beijing.volces.com/api/v3'),

  // Public-reachable base URL used to hand presigned asset URLs to external
  // providers (Seedance pulls reference assets by URL, not byte upload).
  // MUST be set in production. If unset, presigned URLs fall back to
  // MINIO_ENDPOINT — fine only when MinIO is reachable from the provider's
  // network (usually NOT the case for localhost MinIO in dev).
  MINIO_PUBLIC_ENDPOINT: z.string().url().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid worker config:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
