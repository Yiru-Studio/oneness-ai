import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';
import { AppError, ErrorCodes } from '@oneness/shared/errors';

type ErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export const errorHandler: ErrorHandler = (err, c) => {
  const log = c.get('log');

  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: { code: err.code, message: err.message, details: err.details },
    };
    log?.warn({ code: err.code, status: err.httpStatus }, err.message);
    return c.json(body, err.httpStatus as Parameters<typeof c.json>[1]);
  }

  if (err instanceof ZodError) {
    const body: ErrorBody = {
      error: {
        code: ErrorCodes.VALIDATION_FAILED,
        message: 'Request validation failed',
        details: err.flatten(),
      },
    };
    log?.warn({ issues: err.issues }, 'validation failed');
    return c.json(body, 400);
  }

  log?.error({ err: err.message, stack: err.stack }, 'unhandled error');
  const body: ErrorBody = {
    error: { code: ErrorCodes.INTERNAL, message: 'Internal server error' },
  };
  return c.json(body, 500);
};
