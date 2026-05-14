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

  // Shared by every OpenAI-compatible backend (api.openai.com, ZenMux,
  // OpenRouter, DeepSeek, Moonshot, …). Switch backends by changing
  // OPENAI_BASE_URL + OPENAI_API_KEY only.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  // Per-task input.model wins if non-empty; these are the env-level fallbacks.
  // For ZenMux-style proxies, set namespaced names (e.g. 'openai/gpt-4o-mini').
  OPENAI_TEXT_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_IMAGE_MODEL: z.string().default('gpt-image-1'),
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
