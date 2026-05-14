import { getPrismaClient } from '@oneness/shared/prisma';
import { config } from '../config.js';

export const prisma = getPrismaClient({
  log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
