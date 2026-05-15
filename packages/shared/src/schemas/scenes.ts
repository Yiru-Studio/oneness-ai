import { z } from 'zod';
import { CuidSchema } from './common.js';

export const CreateSceneSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  prompt: z.string().max(8000).optional(),
  model: z.string().max(120).optional().nullable(),
  ratio: z.string().max(16).optional().nullable(),
  assetId: CuidSchema.optional().nullable(),
});

export const UpdateSceneSchema = CreateSceneSchema.partial();

export type CreateSceneInput = z.infer<typeof CreateSceneSchema>;
export type UpdateSceneInput = z.infer<typeof UpdateSceneSchema>;
