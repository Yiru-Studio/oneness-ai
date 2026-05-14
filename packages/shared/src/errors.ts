export const ErrorCodes = {
  INTERNAL: 'INTERNAL',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  // Domain-specific (used in later plans)
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  CHARACTER_NOT_FOUND: 'CHARACTER_NOT_FOUND',
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  SCENE_NOT_FOUND: 'SCENE_NOT_FOUND',
  EPISODE_NOT_FOUND: 'EPISODE_NOT_FOUND',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  ASSET_TOO_LARGE: 'ASSET_TOO_LARGE',
  ASSET_TYPE_NOT_ALLOWED: 'ASSET_TYPE_NOT_ALLOWED',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_NOT_CANCELLABLE: 'TASK_NOT_CANCELLABLE',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, httpStatus = 500, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }

  static notFound(code: ErrorCode, message: string, details?: unknown) {
    return new AppError(code, message, 404, details);
  }
  static badRequest(code: ErrorCode, message: string, details?: unknown) {
    return new AppError(code, message, 400, details);
  }
  static unauthorized(message = 'Unauthorized', details?: unknown) {
    return new AppError(ErrorCodes.UNAUTHORIZED, message, 401, details);
  }
  static forbidden(message = 'Forbidden', details?: unknown) {
    return new AppError(ErrorCodes.FORBIDDEN, message, 403, details);
  }
  static conflict(code: ErrorCode, message: string, details?: unknown) {
    return new AppError(code, message, 409, details);
  }
  static internal(message = 'Internal server error', details?: unknown) {
    return new AppError(ErrorCodes.INTERNAL, message, 500, details);
  }
}
