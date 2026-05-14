import { z } from 'zod';

// Postgres TEXT 不允许 NUL 字节（0x00），常见来自 UTF-16 / 某些导出工具产物。
// 在 schema 层统一剥离，避免污染下游 Prisma 调用。
const stripNul = (s: string) => s.replace(/\x00/g, '');

export const CreateEpisodeSchema = z.object({
  number: z.number().int().min(1),
  title: z.string().min(1).max(120).transform(stripNul),
  content: z.string().max(100000).default('').transform(stripNul),
  analyzed: z.boolean().default(false),
});

export const UpdateEpisodeSchema = CreateEpisodeSchema.partial();

export type CreateEpisodeInput = z.infer<typeof CreateEpisodeSchema>;
export type UpdateEpisodeInput = z.infer<typeof UpdateEpisodeSchema>;
