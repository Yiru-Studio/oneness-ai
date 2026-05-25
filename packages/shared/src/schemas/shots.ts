import { z } from 'zod';

const stripNul = (s: string) => s.replace(/\x00/g, '');

export const ShotTypeEnum = z.enum(['new', 'continuation']);
export const ShotCreateTypeEnum = z.enum(['manual', 'assist']);

export const CreateShotSchema = z.object({
  /** Optional — when omitted the server appends after the highest displayId. */
  afterDisplayId: z.number().int().min(0).optional(),
  /** Which episode scene this shot belongs to. Defaults to 0. */
  sceneIndex: z.number().int().min(0).default(0),
  shotType: ShotTypeEnum.default('new'),
  preId: z.number().int().min(1).optional(),
  duration: z.number().int().min(1).max(60).default(4),
  prompt: z.string().max(8000).default('').transform(stripNul),
  model: z.string().min(1).default('seedance'),
  ratio: z.string().min(1).default('16:9'),
  resolution: z.string().min(1).default('720p'),
  // 音画同出 (synchronized audio+video) is the default per product spec.
  generateAudio: z.boolean().default(true),
  characterStyleIds: z.array(z.string()).default([]),
  sceneIds: z.array(z.string()).default([]),
  itemIds: z.array(z.string()).default([]),
  compositionTaskIds: z.array(z.string()).default([]),
});

export const UpdateShotSchema = z
  .object({
    shotType: ShotTypeEnum,
    preId: z.number().int().min(1).nullable(),
    duration: z.number().int().min(1).max(60),
    prompt: z.string().max(8000).transform(stripNul),
    model: z.string().min(1),
    ratio: z.string().min(1),
    resolution: z.string().min(1),
    generateAudio: z.boolean(),
    sketchAssetId: z.string().nullable(),
    characterStyleIds: z.array(z.string()),
    sceneIds: z.array(z.string()),
    itemIds: z.array(z.string()),
    compositionTaskIds: z.array(z.string()),
  })
  .partial();

export type CreateShotInput = z.infer<typeof CreateShotSchema>;
export type UpdateShotInput = z.infer<typeof UpdateShotSchema>;
