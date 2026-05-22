import { z } from 'zod';
import { CuidSchema } from './common.js';
import { ResourceReviewStatus } from '../enums.js';

const ResourceReviewStatusSchema = z.enum([
  ResourceReviewStatus.NEEDS_REVIEW,
  ResourceReviewStatus.CONFIRMED,
]);

export const CreateItemSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  prompt: z.string().max(8000).optional(),
  model: z.string().max(120).optional().nullable(),
  ratio: z.string().max(16).optional().nullable(),
  assetId: CuidSchema.optional().nullable(),
  reviewStatus: ResourceReviewStatusSchema.optional(),
});

export const UpdateItemSchema = CreateItemSchema.partial();

export type CreateItemInput = z.infer<typeof CreateItemSchema>;
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;
