import { createMiddleware } from 'hono/factory';
import { prisma } from '../lib/prisma.js';
import { AppError } from '@oneness/shared/errors';

const SEED_USER_EMAIL = '1280165525@qq.com';

/**
 * Reads the optional Authorization header. If present (any Bearer value),
 * loads the seed user into c.var.user. Otherwise sets it to null.
 *
 * This is the mock-auth phase; real token verification slots in here later
 * without changing route handler signatures.
 */
export const tryReadUser = createMiddleware(async (c, next) => {
  const auth = c.req.header('authorization');
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    c.set('user', null);
    await next();
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
  if (!user) {
    throw AppError.internal('Seed user not found. Run `pnpm db:seed`.');
  }
  c.set('user', user);
  await next();
});

/**
 * Use on routes that require a logged-in user. Must come after tryReadUser.
 */
export const requireUser = createMiddleware(async (c, next) => {
  if (!c.var.user) throw AppError.unauthorized();
  await next();
});
