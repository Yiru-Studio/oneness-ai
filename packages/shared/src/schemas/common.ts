import { z } from 'zod';

// Cuid validator (Prisma default ids start with c, 25 chars, alphanumeric lowercase).
// Loose enough to also accept cuid2 outputs that older code may have generated.
export const CuidSchema = z.string().regex(/^[a-z0-9]{20,32}$/, 'invalid id');

export const IdParamSchema = z.object({ id: CuidSchema });

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageQuery = z.infer<typeof PageQuerySchema>;

export type Paged<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
