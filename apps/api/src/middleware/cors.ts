import { cors } from 'hono/cors';
import { config } from '../config.js';

const origins = config.WEB_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

export const corsMiddleware = cors({
  origin: origins,
  credentials: true,
  allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Internal-Secret'],
  exposeHeaders: ['X-Request-Id'],
});
