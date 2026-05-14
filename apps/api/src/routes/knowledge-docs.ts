import { Hono } from 'hono';
import { zValidator } from '../middleware/validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeKnowledgeDoc } from '../serializers/knowledge-doc.js';
import { paginate, asPaged } from '../lib/pagination.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateKnowledgeDocSchema,
  UpdateKnowledgeDocSchema,
  KnowledgeDocListQuerySchema,
  IdParamSchema,
} from '@oneness/shared/schemas';

export const knowledgeDocRoutes = new Hono();
knowledgeDocRoutes.use('/knowledge-docs', tryReadUser, requireUser);
knowledgeDocRoutes.use('/knowledge-docs/*', tryReadUser, requireUser);

knowledgeDocRoutes.get(
  '/knowledge-docs',
  zValidator('query', KnowledgeDocListQuerySchema),
  async (c) => {
    const user = c.var.user!;
    const q = c.req.valid('query');
    const where = { ownerId: user.id, ...(q.type ? { type: q.type } : {}) };
    const [total, rows] = await Promise.all([
      prisma.knowledgeDoc.count({ where }),
      prisma.knowledgeDoc.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
    ]);
    return c.json(asPaged(rows.map(serializeKnowledgeDoc), total, q));
  },
);

knowledgeDocRoutes.post(
  '/knowledge-docs',
  zValidator('json', CreateKnowledgeDocSchema),
  async (c) => {
    const user = c.var.user!;
    const body = c.req.valid('json');
    const created = await prisma.knowledgeDoc.create({
      data: { ...body, content: body.content ?? null, ownerId: user.id },
    });
    return c.json(serializeKnowledgeDoc(created), 201);
  },
);

knowledgeDocRoutes.get(
  '/knowledge-docs/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const doc = await prisma.knowledgeDoc.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!doc) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'knowledge doc not found');
    return c.json(serializeKnowledgeDoc(doc));
  },
);

knowledgeDocRoutes.patch(
  '/knowledge-docs/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateKnowledgeDocSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await prisma.knowledgeDoc.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!existing) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'knowledge doc not found');
    const updated = await prisma.knowledgeDoc.update({ where: { id }, data: body });
    return c.json(serializeKnowledgeDoc(updated));
  },
);

knowledgeDocRoutes.delete(
  '/knowledge-docs/:id',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id } = c.req.valid('param');
    const existing = await prisma.knowledgeDoc.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!existing) throw AppError.notFound(ErrorCodes.NOT_FOUND, 'knowledge doc not found');
    await prisma.knowledgeDoc.delete({ where: { id } });
    return c.body(null, 204);
  },
);
