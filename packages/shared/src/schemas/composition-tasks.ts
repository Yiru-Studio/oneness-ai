import { z } from 'zod';
import { CuidSchema } from './common.js';

const stripNul = (s: string) => s.replace(/\x00/g, '');

export const CompositionTaskStatusSchema = z.enum([
  'DRAFT',
  'IMAGE_QUEUED',
  'IMAGE_RUNNING',
  'IMAGE_READY',
  'IMAGE_FAILED',
  'GRID_QUEUED',
  'GRID_RUNNING',
  'GRID_READY',
  'GRID_FAILED',
  'APPLIED',
  'SYNCED',
]);

export const CompositionCandidateStatusSchema = z.enum([
  'READY',
  'APPLIED',
  'SYNCED',
]);

export const CompositionImageGenerationSettingsSchema = z.object({
  model: z.string().min(1).max(120),
  ratio: z.string().min(1).max(20),
  quality: z.enum(['1080p', '2k', '4k']).default('1080p'),
  outputCount: z.number().int().min(1).max(4).default(1),
  seed: z.string().max(120).optional().nullable(),
  characterConsistency: z.number().int().min(0).max(100).default(50),
  sceneConsistency: z.number().int().min(0).max(100).default(50),
  itemConsistency: z.number().int().min(0).max(100).default(50),
  negativePrompt: z.string().max(3000).default('').transform(stripNul),
});

export const CompositionGridGenerationSettingsSchema = z.object({
  model: z.string().min(1).max(120),
  ratio: z.string().min(1).max(20),
  specification: z.literal('3x3').default('3x3'),
  variationMode: z.enum(['auto_angles', 'fixed_angles']).default('auto_angles'),
  consistency: z.number().int().min(0).max(100).default(80),
  inheritStyle: z.boolean().default(true),
  inheritSeed: z.boolean().default(false),
});

export const AnalyzeCompositionTasksSchema = z.object({
  episodeId: CuidSchema.optional(),
});

export const UpdateCompositionTaskSchema = z
  .object({
    prompt: z.string().max(8000).transform(stripNul),
    characterStyleIds: z.array(CuidSchema),
    sceneIds: z.array(CuidSchema),
    itemIds: z.array(CuidSchema),
    selectedCandidateIds: z.array(CuidSchema),
  })
  .partial();

export const GenerateCompositionImageSchema = CompositionImageGenerationSettingsSchema.partial();

export const GenerateCompositionGridSchema = CompositionGridGenerationSettingsSchema.partial();

export const ApplyCompositionCandidatesSchema = z.object({
  candidateIds: z.array(CuidSchema).min(1).max(9),
  mode: z.enum(['create_shots', 'replace_existing_shots', 'add_to_storyboard_assets'])
    .default('create_shots'),
  targetShotIds: z.array(CuidSchema).max(9).optional(),
});

export const GenerateShotSketchesSchema = z.object({
  episodeId: CuidSchema,
  sceneIndex: z.number().int().min(0),
  force: z.boolean().default(false),
});

export type AnalyzeCompositionTasksInput = z.infer<typeof AnalyzeCompositionTasksSchema>;
export type UpdateCompositionTaskInput = z.infer<typeof UpdateCompositionTaskSchema>;
export type GenerateCompositionImageInput = z.infer<typeof GenerateCompositionImageSchema>;
export type GenerateCompositionGridInput = z.infer<typeof GenerateCompositionGridSchema>;
export type ApplyCompositionCandidatesInput = z.infer<typeof ApplyCompositionCandidatesSchema>;
export type GenerateShotSketchesInput = z.infer<typeof GenerateShotSketchesSchema>;
