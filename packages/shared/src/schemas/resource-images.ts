import { z } from 'zod';
import { CuidSchema } from './common.js';
import { TaskStatus } from '../enums.js';

export const ResourceImageKindSchema = z.enum([
  'character-style',
  'scene',
  'item',
]);

export const ResourceImageSourceSchema = z.enum([
  'generated',
  'upload',
  'legacy',
]);

export const ResourceImageListQuerySchema = z.object({
  kind: ResourceImageKindSchema,
  entityId: CuidSchema,
});

export const CreateResourceImageSchema = z.object({
  kind: ResourceImageKindSchema,
  entityId: CuidSchema,
  source: ResourceImageSourceSchema.default('upload'),
  status: z.nativeEnum(TaskStatus).default(TaskStatus.SUCCEEDED),
  prompt: z.string().max(8000).optional(),
  model: z.string().max(120).optional().nullable(),
  ratio: z.string().max(16).optional().nullable(),
  assetId: CuidSchema.optional().nullable(),
  taskId: CuidSchema.optional().nullable(),
  error: z.string().max(2000).optional().nullable(),
  setAsCurrent: z.boolean().default(true),
});

export const UpdateResourceImageSchema = z.object({
  status: z.nativeEnum(TaskStatus).optional(),
  prompt: z.string().max(8000).optional(),
  model: z.string().max(120).optional().nullable(),
  ratio: z.string().max(16).optional().nullable(),
  assetId: CuidSchema.optional().nullable(),
  taskId: CuidSchema.optional().nullable(),
  error: z.string().max(2000).optional().nullable(),
  setAsCurrent: z.boolean().optional(),
});

export type ResourceImageKind = z.infer<typeof ResourceImageKindSchema>;
export type ResourceImageSource = z.infer<typeof ResourceImageSourceSchema>;
export type ResourceImageListQuery = z.infer<typeof ResourceImageListQuerySchema>;
export type CreateResourceImageInput = z.infer<typeof CreateResourceImageSchema>;
export type UpdateResourceImageInput = z.infer<typeof UpdateResourceImageSchema>;
