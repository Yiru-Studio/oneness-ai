import { z } from 'zod';
import { CuidSchema } from './common.js';
import { TaskType, TaskStatus } from '../enums.js';

const TaskTypeSchema = z.enum([TaskType.IMAGE, TaskType.VIDEO, TaskType.TEXT_ANALYZE]);
const TaskStatusSchema = z.enum([
  TaskStatus.QUEUED,
  TaskStatus.RUNNING,
  TaskStatus.SUCCEEDED,
  TaskStatus.FAILED,
  TaskStatus.CANCELLED,
]);

const ImageInputSchema = z.object({
  prompt: z.string().min(1).max(5000),
  ratio: z.string().min(1).max(20),
  model: z.string().min(1).max(80),
  referenceAssetIds: z.array(CuidSchema).max(8).optional(),
  n: z.number().int().min(1).max(8).default(1),
});

const VideoReferenceRoleSchema = z.enum([
  'reference_image',
  'reference_video',
  'reference_audio',
  'first_frame',
  'last_frame',
]);

const VideoReferenceSchema = z.object({
  assetId: CuidSchema,
  role: VideoReferenceRoleSchema,
});

const VideoInputSchema = z.object({
  prompt: z.string().min(1).max(5000),
  model: z.string().min(1).max(80),
  duration: z.number().int().min(1).max(60),
  fromAssetId: CuidSchema.optional(),
  ratio: z.string().min(1).max(20).optional(),
  generateAudio: z.boolean().optional(),
  watermark: z.boolean().optional(),
  webSearch: z.boolean().optional(),
  returnLastFrame: z.boolean().optional(),
  // Provider-side enforces per-role counts (image ≤9, video ≤3, audio ≤3).
  references: z.array(VideoReferenceSchema).max(15).optional(),
});

const TextInputSchema = z.object({
  episodeId: CuidSchema,
  analysisType: z.enum(['general', 'basic']),
});

export const CreateTaskSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(TaskType.IMAGE),
    projectId: CuidSchema.optional(),
    provider: z.string().min(1).max(60).default('stub'),
    input: ImageInputSchema,
  }),
  z.object({
    type: z.literal(TaskType.VIDEO),
    projectId: CuidSchema.optional(),
    provider: z.string().min(1).max(60).default('stub'),
    input: VideoInputSchema,
  }),
  z.object({
    type: z.literal(TaskType.TEXT_ANALYZE),
    projectId: CuidSchema, // required for text analysis (always belongs to a project)
    provider: z.string().min(1).max(60).default('stub'),
    input: TextInputSchema,
  }),
]);

export const TaskListQuerySchema = z.object({
  projectId: CuidSchema.optional(),
  type: TaskTypeSchema.optional(),
  status: TaskStatusSchema.optional(),
  cursor: CuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Internal callback (Plan: future external workflow). */
export const InternalUpdateTaskSchema = z.object({
  status: TaskStatusSchema.optional(),
  output: z.unknown().optional(),
  error: z.string().max(2000).optional().nullable(),
  outputAssetIds: z.array(CuidSchema).max(32).optional(),
  actualCostCredits: z.number().int().min(0).optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
export type InternalUpdateTaskInput = z.infer<typeof InternalUpdateTaskSchema>;
