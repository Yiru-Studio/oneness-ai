import { defineConfig } from 'vitest/config';

/**
 * Provide stand-in values for any env vars that worker's config.ts reads at
 * module load. Tests stub the actual network/storage layers — we only need
 * config parsing to succeed.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 10000,
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      MINIO_ENDPOINT: 'http://localhost:9000',
      MINIO_ACCESS_KEY: 'test',
      MINIO_SECRET_KEY: 'test',
      ARK_API_KEY: 'test-key',
      NODE_ENV: 'test',
    },
  },
});
