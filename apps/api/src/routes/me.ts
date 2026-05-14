import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { serializeUser } from '../lib/serialize.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';

const UpdateMeSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
});

export const meRoutes = new Hono();

// GET /api/me returns the user if logged-in, otherwise null (matches existing
// frontend mock behavior so the LoggedIn/LoggedOut UI states keep working).
meRoutes.get('/me', tryReadUser, (c) => {
  const user = c.var.user;
  if (!user) return c.json(null);
  return c.json(serializeUser(user));
});

meRoutes.patch('/me', tryReadUser, requireUser, zValidator('json', UpdateMeSchema), async (c) => {
  const user = c.var.user!;
  const data = c.req.valid('json');
  const updated = await prisma.user.update({ where: { id: user.id }, data });
  return c.json(serializeUser(updated));
});
