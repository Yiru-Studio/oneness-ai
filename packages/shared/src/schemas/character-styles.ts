import { z } from 'zod';
import { CuidSchema } from './common.js';

export const CreateCharacterStyleSchema = z.object({
  name: z.string().min(1).max(120),
  assetId: CuidSchema.optional().nullable(),
});

export const UpdateCharacterStyleSchema = CreateCharacterStyleSchema.partial();

export type CreateCharacterStyleInput = z.infer<typeof CreateCharacterStyleSchema>;
export type UpdateCharacterStyleInput = z.infer<typeof UpdateCharacterStyleSchema>;
