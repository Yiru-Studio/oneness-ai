import { prisma } from './prisma.js';
import { TaskStatus, TaskType } from '@oneness/shared/enums';
import type { AnalysisSummary } from '../serializers/project.js';

/**
 * Aggregate TEXT_ANALYZE task status for a set of project ids. Returns a map
 * keyed by projectId; missing entries mean "no tasks at all".
 *
 * Implementation: one groupBy aggregate over Task to avoid N+1.
 */
export async function summarizeAnalysisForProjects(
  projectIds: string[],
): Promise<Map<string, AnalysisSummary>> {
  if (projectIds.length === 0) return new Map();

  const rows = await prisma.task.groupBy({
    by: ['projectId', 'status'],
    where: {
      projectId: { in: projectIds },
      type: TaskType.TEXT_ANALYZE,
    },
    _count: { _all: true },
  });

  const buckets = new Map<string, { total: number; succeeded: number }>();
  for (const r of rows) {
    if (!r.projectId) continue;
    const cur = buckets.get(r.projectId) ?? { total: 0, succeeded: 0 };
    cur.total += r._count._all;
    if (r.status === TaskStatus.SUCCEEDED) cur.succeeded += r._count._all;
    buckets.set(r.projectId, cur);
  }

  const out = new Map<string, AnalysisSummary>();
  for (const [pid, b] of buckets) {
    out.set(pid, { hasTasks: b.total > 0, allSucceeded: b.total === b.succeeded });
  }
  return out;
}

export async function summarizeAnalysisForProject(
  projectId: string,
): Promise<AnalysisSummary> {
  const map = await summarizeAnalysisForProjects([projectId]);
  return map.get(projectId) ?? { hasTasks: false, allSucceeded: false };
}
