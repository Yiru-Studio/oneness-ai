import { z } from 'zod';
import { KnowledgeDocType } from '../enums.js';

const KnowledgeDocTypeSchema = z.enum([
  KnowledgeDocType.CREATED,
  KnowledgeDocType.FAVORITED,
  KnowledgeDocType.COLLABORATED,
]);

export const CreateKnowledgeDocSchema = z.object({
  title: z.string().min(1).max(200),
  type: KnowledgeDocTypeSchema,
  content: z.string().max(50000).optional().nullable(),
});

export const UpdateKnowledgeDocSchema = CreateKnowledgeDocSchema.partial();

export const KnowledgeDocListQuerySchema = z.object({
  type: KnowledgeDocTypeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateKnowledgeDocInput = z.infer<typeof CreateKnowledgeDocSchema>;
export type UpdateKnowledgeDocInput = z.infer<typeof UpdateKnowledgeDocSchema>;
export type KnowledgeDocListQuery = z.infer<typeof KnowledgeDocListQuerySchema>;
