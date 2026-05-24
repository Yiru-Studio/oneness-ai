import type { Project } from '@oneness/shared/prisma';

export type AnalysisSubjectState = 'idle' | 'running' | 'failed' | 'completed';
export type AnalysisSubjects = {
  characters: AnalysisSubjectState;
  scenes: AnalysisSubjectState;
  items: AnalysisSubjectState;
};

export type ProjectDTO = {
  id: string;
  name: string;
  ratio: string;
  style: string;
  createdAt: string;
  stylePrompt: string;
  analysisModel: string;
  imageModel: string;
  videoModel: string;
  generalAnalysis: 'pending' | 'completed';
  basicAnalysis: 'pending' | 'completed';
  analysisStarted: boolean;
  analysisState: 'idle' | 'running' | 'failed' | 'completed';
  analysisSubjects: AnalysisSubjects;
};

export type AnalysisSummary = {
  /** at least one subject-extraction TEXT_ANALYZE task exists for this project */
  hasTasks: boolean;
  /** the latest character, item, and scene extraction tasks all succeeded */
  allSucceeded: boolean;
  /** at least one relevant analysis task is queued or running */
  hasInFlight?: boolean;
  /** at least one relevant analysis task failed or was cancelled */
  hasFailed?: boolean;
  /** latest status for each subject-extraction task */
  subjects: AnalysisSubjects;
};

const idleSubjects: AnalysisSubjects = {
  characters: 'idle',
  scenes: 'idle',
  items: 'idle',
};

const completedSubjects: AnalysisSubjects = {
  characters: 'completed',
  scenes: 'completed',
  items: 'completed',
};

/**
 * Both generalAnalysis and basicAnalysis are derived from the same fan-out
 * (characters + items + scenes TEXT_ANALYZE tasks). If a summary is provided,
 * it overrides the stored enum on the Project row — the row's value is just an
 * initial/fallback state set at create time.
 */
export function serializeProject(p: Project, summary?: AnalysisSummary): ProjectDTO {
  const derived = summary && summary.hasTasks && summary.allSucceeded ? 'completed' : null;
  const fallbackCompleted =
    p.generalAnalysis === 'COMPLETED' && p.basicAnalysis === 'COMPLETED';
  const analysisSubjects = summary?.hasTasks
    ? summary.subjects
    : fallbackCompleted
      ? completedSubjects
      : idleSubjects;
  const analysisStarted = Boolean(summary?.hasTasks || fallbackCompleted);
  const subjectStates = Object.values(analysisSubjects);
  const analysisState: ProjectDTO['analysisState'] = subjectStates.every(
    (state) => state === 'completed',
  )
    ? 'completed'
    : subjectStates.some((state) => state === 'running')
      ? 'running'
      : subjectStates.some((state) => state === 'failed')
        ? 'failed'
        : 'idle';

  return {
    id: p.id,
    name: p.name,
    ratio: p.ratio,
    style: p.style,
    createdAt: p.createdAt.toISOString(),
    stylePrompt: p.stylePrompt,
    analysisModel: p.analysisModel,
    imageModel: p.imageModel,
    videoModel: p.videoModel,
    generalAnalysis:
      derived ?? (p.generalAnalysis.toLowerCase() as 'pending' | 'completed'),
    basicAnalysis:
      derived ?? (p.basicAnalysis.toLowerCase() as 'pending' | 'completed'),
    analysisStarted,
    analysisState,
    analysisSubjects,
  };
}
