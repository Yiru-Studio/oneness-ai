import type { Project } from '@oneness/shared/prisma';

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
};

export function serializeProject(p: Project): ProjectDTO {
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
    generalAnalysis: p.generalAnalysis.toLowerCase() as 'pending' | 'completed',
    basicAnalysis: p.basicAnalysis.toLowerCase() as 'pending' | 'completed',
  };
}
