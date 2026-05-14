import { z } from 'zod';
import { CuidSchema } from './common.js';

export const CreateCharacterSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(2000).default(''),
  bio: z.string().max(5000).default(''),
  voice: z.string().max(120).optional().nullable(),
  avatarAssetId: CuidSchema.optional().nullable(),
});

export const UpdateCharacterSchema = CreateCharacterSchema.partial();

export type CreateCharacterInput = z.infer<typeof CreateCharacterSchema>;
export type UpdateCharacterInput = z.infer<typeof UpdateCharacterSchema>;
