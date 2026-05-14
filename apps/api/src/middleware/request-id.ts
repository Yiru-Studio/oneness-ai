import { createMiddleware } from 'hono/factory';
import { createId } from '@paralleldrive/cuid2';
import { logger } from '@oneness/shared/logger';
import '../types/hono-env.js';

export const requestIdMiddleware = createMiddleware(async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const requestId = incoming && incoming.length > 0 ? incoming : createId();
  c.set('requestId', requestId);
  c.set('log', logger.child({ requestId, method: c.req.method, path: c.req.path }));
  c.header('X-Request-Id', requestId);

  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  c.get('log').info({ status: c.res.status, ms }, 'request completed');
});
