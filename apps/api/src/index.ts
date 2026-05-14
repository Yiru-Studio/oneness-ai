import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import { logger } from '@oneness/shared/logger';
import { corsMiddleware } from './middleware/cors.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { healthRoutes } from './routes/health.js';
import './types/hono-env.js';

const app = new Hono();

app.use('*', corsMiddleware);
app.use('*', requestIdMiddleware);
app.onError(errorHandler);

app.route('/api', healthRoutes);
app.route('/api', authRoutes);
app.route('/api', meRoutes);

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port }, 'API server started');
});
