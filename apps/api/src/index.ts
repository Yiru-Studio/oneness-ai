import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import { logger } from '@oneness/shared/logger';

const app = new Hono();

app.get('/api/_hello', (c) => c.json({ ok: true, env: config.NODE_ENV }));

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port }, 'API server started');
});
