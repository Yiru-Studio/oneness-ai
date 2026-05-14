import { Hono } from 'hono';
import { zValidator } from '../middleware/validator';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { serializeUser } from '../lib/serialize.js';
import { AppError } from '@oneness/shared/errors';

const SEED_USER_EMAIL = '1280165525@qq.com';

const LoginSchema = z.object({
  email: z.string().email(),
  code: z.string().min(1),
});

export const authRoutes = new Hono();

authRoutes.post('/auth/login', zValidator('json', LoginSchema), async (c) => {
  // Mock auth: accepts any email/code, returns seed user.
  const user = await prisma.user.findUnique({ where: { email: SEED_USER_EMAIL } });
  if (!user) throw AppError.internal('Seed user not found. Run `pnpm db:seed`.');
  const token = `mock_token_${Date.now()}`;
  return c.json({ token, user: serializeUser(user) });
});

authRoutes.post('/auth/logout', (c) => c.body(null, 204));
