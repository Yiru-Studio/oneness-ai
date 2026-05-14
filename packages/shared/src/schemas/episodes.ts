import { z } from 'zod';

export const CreateEpisodeSchema = z.object({
  number: z.number().int().min(1),
  title: z.string().min(1).max(120),
  content: z.string().max(20000).default(''),
  analyzed: z.boolean().default(false),
});

export const UpdateEpisodeSchema = CreateEpisodeSchema.partial();

export type CreateEpisodeInput = z.infer<typeof CreateEpisodeSchema>;
export type UpdateEpisodeInput = z.infer<typeof UpdateEpisodeSchema>;
