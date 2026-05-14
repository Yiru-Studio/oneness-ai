import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MINIO_ENDPOINT: z.string().url(),
  // Public-reachable base URL used to mint presigned GET/PUT URLs handed to
  // browsers. Must be set in production whenever MINIO_ENDPOINT points to an
  // internal hostname (e.g. http://minio:9000 inside Docker). Falls back to
  // MINIO_ENDPOINT in dev.
  MINIO_PUBLIC_ENDPOINT: z.string().url().optional(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET_USER_UPLOADS: z.string().default('user-uploads'),
  MINIO_BUCKET_TASK_OUTPUTS: z.string().default('task-outputs'),
  WEB_ORIGINS: z.string().default('http://localhost:3000'),
  INTERNAL_SECRET: z.string().min(16),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  // Default provider names mirror the worker's env vars; the API uses them
  // when a request doesn't specify a provider explicitly (e.g. the analyze
  // fan-out endpoint).
  PROVIDER_IMAGE: z.string().default('stub'),
  PROVIDER_VIDEO: z.string().default('stub'),
  PROVIDER_TEXT: z.string().default('stub'),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
