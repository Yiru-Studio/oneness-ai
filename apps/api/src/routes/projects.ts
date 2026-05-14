import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeProject } from '../serializers/project.js';
import { paginate, asPaged } from '../lib/pagination.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  ProjectListQuerySchema,
  IdParamSchema,
} from '@oneness/shared/schemas';

export const projectRoutes = new Hono();

projectRoutes.use('/projects', tryReadUser, requireUser);
projectRoutes.use('/projects/*', tryReadUser, requireUser);

projectRoutes.get('/projects', zValidator('query', ProjectListQuerySchema), async (c) => {
  const user = c.var.user!;
  const q = c.req.valid('query');
  const where = {
    ownerId: user.id,
    ...(q.search ? { name: { contains: q.search } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginate(q),
    }),
  ]);
  return c.json(asPaged(rows.map(serializeProject), total, q));
});

projectRoutes.post('/projects', zValidator('json', CreateProjectSchema), async (c) => {
  const user = c.var.user!;
  const body = c.req.valid('json');
  const created = await prisma.project.create({
    data: { ...body, ownerId: user.id },
  });
  return c.json(serializeProject(created), 201);
});

projectRoutes.get('/projects/:id', zValidator('param', IdParamSchema), async (c) => {
  const user = c.var.user!;
  const { id } = c.req.valid('param');
  const project = await prisma.project.findFirst({
    where: { id, ownerId: user.id },
  });
  if (!project) {
    throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
  }
  return c.json(serializeProject(project));
});

projectRoutes.patch(
  '/projects/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateProjectSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await prisma.project.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!existing) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    const updated = await prisma.project.update({ where: { id }, data: body });
    return c.json(serializeProject(updated));
  },
);

projectRoutes.delete(
  '/projects/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const existing = await prisma.project.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!existing) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    await prisma.project.delete({ where: { id } });
    return c.body(null, 204);
  },
);
