import { Hono } from 'hono';
import { zValidator } from '../middleware/validator';
import { prisma } from '../lib/prisma.js';
import { tryReadUser, requireUser } from '../middleware/auth.js';
import { serializeProject } from '../serializers/project.js';
import { paginate, asPaged } from '../lib/pagination.js';
import {
  summarizeAnalysisForProject,
  summarizeAnalysisForProjects,
} from '../lib/analysis-summary.js';
import { AppError, ErrorCodes } from '@oneness/shared/errors';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  ProjectListQuerySchema,
  IdParamSchema,
} from '@oneness/shared/schemas';
import type { AnalyticsDTO } from '../serializers/analytics.js';
import { TaskType, TaskStatus } from '@oneness/shared/enums';

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
  const summaries = await summarizeAnalysisForProjects(rows.map((r) => r.id));
  return c.json(
    asPaged(
      rows.map((r) => serializeProject(r, summaries.get(r.id))),
      total,
      q,
    ),
  );
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
  const summary = await summarizeAnalysisForProject(project.id);
  return c.json(serializeProject(project, summary));
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
    const summary = await summarizeAnalysisForProject(updated.id);
    return c.json(serializeProject(updated, summary));
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

projectRoutes.get(
  '/projects/:id/analytics',
  zValidator('param', IdParamSchema),
  async (c) => {
    const user = c.var.user!;
    const { id: projectId } = c.req.valid('param');
    const project = await prisma.project.findFirst({
      where: { id: projectId, ownerId: user.id },
      select: { id: true },
    });
    if (!project) {
      throw AppError.notFound(ErrorCodes.PROJECT_NOT_FOUND, 'project not found');
    }
    // Only count tasks that actually consumed credits (succeeded or in-flight).
    const includedStatuses = [TaskStatus.SUCCEEDED, TaskStatus.RUNNING, TaskStatus.QUEUED];
    const [byType, totalAgg, latest] = await Promise.all([
      prisma.task.groupBy({
        by: ['type'],
        where: { projectId, status: { in: includedStatuses } },
        _count: { _all: true },
      }),
      prisma.task.aggregate({
        where: { projectId, status: { in: includedStatuses } },
        _sum: { costCredits: true },
      }),
      prisma.task.findFirst({
        where: { projectId },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);
    const countOf = (t: typeof TaskType.IMAGE | typeof TaskType.VIDEO | typeof TaskType.TEXT_ANALYZE) =>
      byType.find((b) => b.type === t)?._count._all ?? 0;
    const dto: AnalyticsDTO = {
      totalCredits: totalAgg._sum.costCredits ?? 0,
      imageCount: countOf(TaskType.IMAGE),
      videoCount: countOf(TaskType.VIDEO),
      textTaskCount: countOf(TaskType.TEXT_ANALYZE),
      updateTime: (latest?.updatedAt ?? new Date()).toISOString(),
    };
    return c.json(dto);
  },
);
