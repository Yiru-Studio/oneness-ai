import type { User } from '@prisma/client';
import type { Logger } from '@oneness/shared/logger';

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    log: Logger;
    user: User | null;
  }
}

export {};
