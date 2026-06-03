import { prisma } from './prisma.js';
import { TaskStatus, TaskType } from '@oneness/shared/enums';
import type {
  AnalysisSubjectState,
  AnalysisSubjects,
  AnalysisSummary,
} from '../serializers/project.js';

const SUBJECT_TYPES = ['characters', 'scenes', 'items'] as const;
const SUBJECT_TYPE_SET = new Set<string>(SUBJECT_TYPES);
type SubjectType = (typeof SUBJECT_TYPES)[number];

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
    const subjects = emptySubjects();
    for (const subjectType of SUBJECT_TYPES) {
      const entry = bySubject.get(subjectType);
      if (entry) subjects[subjectType] = toSubjectState(entry.status);
    }
    if (subjects.characters === 'completed') {
      subjects.characters = await characterDetailState(pid, rows);
    }
    const statuses = Object.values(subjects);
    out.set(pid, {
      hasTasks: bySubject.size > 0,
      allSucceeded: statuses.every((status) => status === 'completed'),
      hasInFlight: statuses.some((status) => status === 'running'),
      hasFailed: statuses.some((status) => status === 'failed'),
      subjects,
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
    subjects: emptySubjects(),
  };
}

async function characterDetailState(
  projectId: string,
  rows: Array<{ projectId: string | null; status: TaskStatus; input: unknown; createdAt: Date }>,
): Promise<AnalysisSubjectState> {
  const characterCount = await prisma.character.count({ where: { projectId } });
  if (characterCount === 0) return 'completed';

  const latestByCharacter = new Map<string, { status: TaskStatus; createdAt: Date }>();
  for (const row of rows) {
    if (row.projectId !== projectId) continue;
    const characterId = getCharacterDetailId(row.input);
    if (!characterId) continue;
    const current = latestByCharacter.get(characterId);
    if (!current || current.createdAt <= row.createdAt) {
      latestByCharacter.set(characterId, { status: row.status, createdAt: row.createdAt });
    }
  }

  const statuses = [...latestByCharacter.values()].map((entry) => entry.status);
  if (statuses.some((status) =>
    status === TaskStatus.QUEUED ||
    status === TaskStatus.RUNNING ||
    status === TaskStatus.RETRYING
  )) {
    return 'running';
  }
  if (statuses.some((status) => status === TaskStatus.FAILED || status === TaskStatus.CANCELLED)) {
    return 'failed';
  }
  if (statuses.filter((status) => status === TaskStatus.SUCCEEDED).length >= characterCount) {
    return 'completed';
  }
  return 'running';
}

function getSubjectExtractionType(input: unknown): SubjectType | null {
  if (!input || typeof input !== 'object' || !('subjectType' in input)) return null;
  const subjectType = (input as { subjectType?: unknown }).subjectType;
  return typeof subjectType === 'string' && SUBJECT_TYPE_SET.has(subjectType)
    ? (subjectType as SubjectType)
    : null;
}

function getCharacterDetailId(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const obj = input as { analysisType?: unknown; characterId?: unknown };
  if (obj.analysisType !== 'character_detail') return null;
  return typeof obj.characterId === 'string' && obj.characterId.length > 0
    ? obj.characterId
    : null;
}

function emptySubjects(): AnalysisSubjects {
  return {
    characters: 'idle',
    scenes: 'idle',
    items: 'idle',
  };
}

function toSubjectState(status: TaskStatus): AnalysisSubjectState {
  if (status === TaskStatus.SUCCEEDED) return 'completed';
  if (
    status === TaskStatus.QUEUED ||
    status === TaskStatus.RUNNING ||
    status === TaskStatus.RETRYING
  ) return 'running';
  return 'failed';
}
