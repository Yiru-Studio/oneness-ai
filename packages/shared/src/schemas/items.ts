import { z } from 'zod';
import { CuidSchema } from './common.js';

export const CreateItemSchema = z.object({
  name: z.string().min(1).max(120),
  assetId: CuidSchema.optional().nullable(),
});

export const UpdateItemSchema = CreateItemSchema.partial();

export type CreateItemInput = z.infer<typeof CreateItemSchema>;
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;
