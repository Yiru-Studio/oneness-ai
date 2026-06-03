import { TaskStatus } from '@oneness/shared/enums';

export type RetryDecisionInput = {
  error: Error;
  taskType: string;
  provider: string;
  status: string;
  retryCount: number;
  firstRetryAt: Date | null;
  retryUntil: Date | null;
  now?: Date;
  retryWindowMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
  random?: () => number;
};

export type RetryDecision =
  | {
      retryable: true;
      now: Date;
      firstRetryAt: Date;
      retryUntil: Date;
      nextRetryAt: Date;
      delayMs: number;
      reason: string;
    }
  | {
      retryable: false;
      reason: string;
    };

const TRANSIENT_PATTERNS = [
  'upstream_error',
  'rate_limit',
  'timeout',
  'fetch failed',
  'network',
  'econnreset',
  'etimedout',
  'http_408',
  'http_409',
  'http_425',
  'http_429',
];

const TERMINAL_PATTERNS = [
  'aborted',
  'cancel',
  'invalid',
  'validation',
  'not found',
  'insufficient_credit',
  'insufficient credit',
  'auth',
  'unauthorized',
  'forbidden',
  'api key',
  'permission',
  'http_400',
  'http_401',
  'http_402',
  'http_403',
  'http_404',
];

export function isRetryingStatus(status: string): boolean {
  return status === TaskStatus.RETRYING;
}

export function isRunnableTaskStatus(status: string): boolean {
  return status === TaskStatus.QUEUED || status === TaskStatus.RETRYING;
}

export function isRetryableProviderError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  if (TERMINAL_PATTERNS.some((pattern) => msg.includes(pattern))) return false;
  return (
    TRANSIENT_PATTERNS.some((pattern) => msg.includes(pattern)) ||
    /http_5\d\d/.test(msg)
  );
}

export function decideImageRetry(input: RetryDecisionInput): RetryDecision {
  if (input.taskType !== 'IMAGE') return { retryable: false, reason: 'not_image_task' };
  if (!isRetryManagedProvider(input.provider, input.error)) {
    return { retryable: false, reason: 'provider_not_retry_managed' };
  }
  if (!isRetryableProviderError(input.error)) {
    return { retryable: false, reason: 'terminal_provider_error' };
  }

  const now = input.now ?? new Date();
  const firstRetryAt = input.firstRetryAt ?? now;
  const retryUntil =
    input.retryUntil ?? new Date(firstRetryAt.getTime() + input.retryWindowMs);

  if (now.getTime() >= retryUntil.getTime()) {
    return { retryable: false, reason: 'retry_window_exhausted' };
  }

  const delayMs = retryDelayMs({
    retryCount: input.retryCount,
    baseDelayMs: input.baseDelayMs,
    maxDelayMs: input.maxDelayMs,
    remainingWindowMs: retryUntil.getTime() - now.getTime(),
    random: input.random,
  });
  return {
    retryable: true,
    now,
    firstRetryAt,
    retryUntil,
    nextRetryAt: new Date(now.getTime() + delayMs),
    delayMs,
    reason: 'transient_provider_error',
  };
}

function isRetryManagedProvider(provider: string, error: Error): boolean {
  if (provider === 'openai') return true;
  return process.env.NODE_ENV === 'test' &&
    provider === 'stub' &&
    error.message.toLowerCase().includes('openai[');
}

export function retryDelayMs(args: {
  retryCount: number;
  baseDelayMs: number;
  maxDelayMs: number;
  remainingWindowMs: number;
  random?: () => number;
}): number {
  const exponent = Math.min(Math.max(args.retryCount, 0), 10);
  const exponential = Math.min(
    args.maxDelayMs,
    args.baseDelayMs * Math.pow(2, exponent),
  );
  const rand = args.random ?? Math.random;
  const jitterFactor = 0.75 + rand() * 0.5;
  const jittered = Math.max(1000, Math.round(exponential * jitterFactor));
  return Math.max(1000, Math.min(jittered, args.remainingWindowMs));
}
