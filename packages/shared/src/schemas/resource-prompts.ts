import { z } from 'zod';
import { CuidSchema } from './common.js';
import { ResourceImageKindSchema } from './resource-images.js';

export const GenerateResourcePromptSchema = z.object({
  kind: ResourceImageKindSchema,
  entityId: CuidSchema,
  model: z.string().min(1).max(80).optional(),
});

export type GenerateResourcePromptInput = z.infer<typeof GenerateResourcePromptSchema>;
