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
import { assetRoutes } from './routes/assets.js';
import { projectRoutes } from './routes/projects.js';
import { characterRoutes } from './routes/characters.js';
import { characterStyleRoutes } from './routes/character-styles.js';
import { itemRoutes } from './routes/items.js';
import { sceneRoutes } from './routes/scenes.js';
import { episodeRoutes } from './routes/episodes.js';
import { shotRoutes } from './routes/shots.js';
import { knowledgeDocRoutes } from './routes/knowledge-docs.js';
import { taskRoutes } from './routes/tasks.js';
import { resourceImageRoutes } from './routes/resource-images.js';
import { resourcePromptRoutes } from './routes/resource-prompts.js';
import './types/hono-env.js';

const app = new Hono();

app.use('*', corsMiddleware);
app.use('*', requestIdMiddleware);
app.onError(errorHandler);

app.route('/api', healthRoutes);
app.route('/api', authRoutes);
app.route('/api', meRoutes);
app.route('/api', assetRoutes);
app.route('/api', projectRoutes);
app.route('/api', characterRoutes);
app.route('/api', characterStyleRoutes);
app.route('/api', itemRoutes);
app.route('/api', sceneRoutes);
app.route('/api', episodeRoutes);
app.route('/api', shotRoutes);
app.route('/api', knowledgeDocRoutes);
app.route('/api', resourceImageRoutes);
app.route('/api', resourcePromptRoutes);
app.route('/api', taskRoutes);

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info({ port: info.port }, 'API server started');
});
