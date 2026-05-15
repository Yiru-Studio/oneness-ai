import { z } from 'zod';
import { CuidSchema } from './common.js';

export const CreateCharacterStyleSchema = z.object({
  name: z.string().min(1).max(120),
  prompt: z.string().max(8000).optional(),
  model: z.string().max(120).optional().nullable(),
  ratio: z.string().max(16).optional().nullable(),
  assetId: CuidSchema.optional().nullable(),
});

export const UpdateCharacterStyleSchema = CreateCharacterStyleSchema.partial();

export type CreateCharacterStyleInput = z.infer<typeof CreateCharacterStyleSchema>;
export type UpdateCharacterStyleInput = z.infer<typeof UpdateCharacterStyleSchema>;
