import { z } from 'zod';
import { CuidSchema } from './common.js';

export const ImageGenerationRunsQuerySchema = z.object({
  projectId: CuidSchema,
  status: z.string().min(1).max(40).optional(),
  activeOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export type ImageGenerationRunsQuery = z.infer<typeof ImageGenerationRunsQuerySchema>;
