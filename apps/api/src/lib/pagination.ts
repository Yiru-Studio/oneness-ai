import type { PageQuery, Paged } from '@oneness/shared/schemas';

export function paginate(q: PageQuery): { skip: number; take: number } {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function asPaged<T>(items: T[], total: number, q: PageQuery): Paged<T> {
  return { items, total, page: q.page, pageSize: q.pageSize };
}
