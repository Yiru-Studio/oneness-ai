import { z } from 'zod';
import { CuidSchema } from './common.js';

export const CreateSceneSchema = z.object({
  name: z.string().min(1).max(120),
  assetId: CuidSchema.optional().nullable(),
});

export const UpdateSceneSchema = CreateSceneSchema.partial();

export type CreateSceneInput = z.infer<typeof CreateSceneSchema>;
export type UpdateSceneInput = z.infer<typeof UpdateSceneSchema>;
