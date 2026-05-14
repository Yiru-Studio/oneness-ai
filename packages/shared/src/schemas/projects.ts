import { z } from 'zod';
import { AnalysisStatus } from '../enums.js';

const AnalysisStatusSchema = z.enum([AnalysisStatus.PENDING, AnalysisStatus.COMPLETED]);

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  ratio: z.string().min(1).max(20),
  style: z.string().min(1).max(60),
  stylePrompt: z.string().max(5000).default(''),
  analysisModel: z.string().min(1).max(80),
  imageModel: z.string().min(1).max(80),
  videoModel: z.string().min(1).max(80),
  generalAnalysis: AnalysisStatusSchema.default(AnalysisStatus.PENDING),
  basicAnalysis: AnalysisStatusSchema.default(AnalysisStatus.PENDING),
});

export const UpdateProjectSchema = CreateProjectSchema.partial();

export const ProjectListQuerySchema = z.object({
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;
