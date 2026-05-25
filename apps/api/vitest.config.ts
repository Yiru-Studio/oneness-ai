import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../..');

/**
 * Minimal .env loader (vitest 2.x does not re-export loadEnv). Reads
 * KEY=VALUE lines from the repo-root .env so integration tests pick up
 * DATABASE_URL / REDIS_URL / MINIO_* / INTERNAL_SECRET without manual
 * dotenv-cli wrapping.
 */
function loadDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = {
  ...loadDotEnv(resolve(repoRoot, '.env')),
  ...loadDotEnv(resolve(repoRoot, '.env.local')),
  ...Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => (
      typeof entry[1] === 'string'
    )),
  ),
};

export default defineConfig({
  test: {
    include: ['src/**/*.unit.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    env,
  },
});
