import { prisma } from './prisma.js';
import { TaskStatus, TaskType } from '@oneness/shared/enums';
import type { AnalysisSummary } from '../serializers/project.js';

const SUBJECT_TYPES = new Set(['characters', 'items', 'scenes']);
type SubjectType = 'characters' | 'items' | 'scenes';

/**
 * Aggregate latest subject-extraction TEXT_ANALYZE task status for a set of
 * project ids. Scene-list and shot-breakdown TEXT_ANALYZE jobs are separate
 * workflow steps and must not affect the project-level entity analysis state.
 */
export async function summarizeAnalysisForProjects(
  projectIds: string[],
): Promise<Map<string, AnalysisSummary>> {
  if (projectIds.length === 0) return new Map();

  const rows = await prisma.task.findMany({
    where: {
      projectId: { in: projectIds },
      type: TaskType.TEXT_ANALYZE,
    },
    select: {
      projectId: true,
      status: true,
      input: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const latestByProject = new Map<
    string,
    Map<SubjectType, { status: TaskStatus; createdAt: Date }>
  >();
  for (const r of rows) {
    if (!r.projectId) continue;
    const subjectType = getSubjectExtractionType(r.input);
    if (!subjectType) continue;
    const bySubject = latestByProject.get(r.projectId) ?? new Map();
    const current = bySubject.get(subjectType);
    if (!current || current.createdAt <= r.createdAt) {
      bySubject.set(subjectType, { status: r.status, createdAt: r.createdAt });
    }
    latestByProject.set(r.projectId, bySubject);
  }

  const out = new Map<string, AnalysisSummary>();
  for (const [pid, bySubject] of latestByProject) {
    const statuses = [...bySubject.values()].map((entry) => entry.status);
    const succeeded = statuses.filter((status) => status === TaskStatus.SUCCEEDED).length;
    const inFlight = statuses.filter(
      (status) => status === TaskStatus.QUEUED || status === TaskStatus.RUNNING,
    ).length;
    const failed = statuses.filter(
      (status) => status === TaskStatus.FAILED || status === TaskStatus.CANCELLED,
    ).length;
    out.set(pid, {
      hasTasks: statuses.length > 0,
      allSucceeded: bySubject.size === SUBJECT_TYPES.size && succeeded === SUBJECT_TYPES.size,
      hasInFlight: inFlight > 0,
      hasFailed: failed > 0,
    });
  }
  return out;
}

export async function summarizeAnalysisForProject(
  projectId: string,
): Promise<AnalysisSummary> {
  const map = await summarizeAnalysisForProjects([projectId]);
  return map.get(projectId) ?? {
    hasTasks: false,
    allSucceeded: false,
    hasInFlight: false,
    hasFailed: false,
  };
}

function getSubjectExtractionType(input: unknown): SubjectType | null {
  if (!input || typeof input !== 'object' || !('subjectType' in input)) return null;
  const subjectType = (input as { subjectType?: unknown }).subjectType;
  return typeof subjectType === 'string' && SUBJECT_TYPES.has(subjectType)
    ? (subjectType as SubjectType)
    : null;
}
