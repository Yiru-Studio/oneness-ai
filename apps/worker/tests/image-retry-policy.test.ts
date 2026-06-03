import { describe, expect, it } from 'vitest';
import { TaskStatus, TaskType } from '@oneness/shared/enums';
import {
  decideImageRetry,
  isRetryableProviderError,
  retryDelayMs,
} from '../src/lib/image-retry-policy.js';

describe('image retry policy', () => {
  it.each([
    'openai[http_502]: 502 upstream request failed',
    'openai[upstream_error]: upstream request failed',
    'openai[http_500]: server error',
    'openai[http_503]: unavailable',
    'openai[rate_limit]: too many requests',
    'worker[timeout]: image task exceeded 100ms',
    'fetch failed',
    'network econnreset',
  ])('treats %s as retryable', (message) => {
    expect(isRetryableProviderError(new Error(message))).toBe(true);
  });

  it.each([
    'openai[invalid_params]: invalid prompt',
    'openai[auth_error]: bad api key',
    'openai[insufficient_credit]: no credit',
    'reference asset not found',
    'openai[aborted]',
    'cancel detected',
  ])('treats %s as terminal', (message) => {
    expect(isRetryableProviderError(new Error(message))).toBe(false);
  });

  it('uses capped exponential backoff with jitter and retry window bound', () => {
    expect(
      retryDelayMs({
        retryCount: 0,
        baseDelayMs: 10_000,
        maxDelayMs: 60_000,
        remainingWindowMs: 120_000,
        random: () => 0.5,
      }),
    ).toBe(10_000);

    expect(
      retryDelayMs({
        retryCount: 4,
        baseDelayMs: 10_000,
        maxDelayMs: 60_000,
        remainingWindowMs: 30_000,
        random: () => 0.5,
      }),
    ).toBe(30_000);
  });

  it('schedules retrying image tasks inside the retry window', () => {
    const now = new Date('2026-06-03T10:00:00.000Z');
    const decision = decideImageRetry({
      error: new Error('openai[http_502]: upstream request failed'),
      taskType: TaskType.IMAGE,
      provider: 'openai',
      status: TaskStatus.RUNNING,
      retryCount: 0,
      firstRetryAt: null,
      retryUntil: null,
      now,
      retryWindowMs: 86_400_000,
      baseDelayMs: 10_000,
      maxDelayMs: 60_000,
      random: () => 0.5,
    });

    expect(decision.retryable).toBe(true);
    if (decision.retryable) {
      expect(decision.firstRetryAt).toEqual(now);
      expect(decision.retryUntil.toISOString()).toBe('2026-06-04T10:00:00.000Z');
      expect(decision.nextRetryAt.toISOString()).toBe('2026-06-03T10:00:10.000Z');
    }
  });

  it('does not apply managed retry to non-openai providers', () => {
    const decision = decideImageRetry({
      error: new Error('stub-image: random failure'),
      taskType: TaskType.IMAGE,
      provider: 'stub',
      status: TaskStatus.RUNNING,
      retryCount: 0,
      firstRetryAt: null,
      retryUntil: null,
      retryWindowMs: 86_400_000,
      baseDelayMs: 10_000,
      maxDelayMs: 60_000,
    });

    expect(decision).toEqual({ retryable: false, reason: 'provider_not_retry_managed' });
  });

  it('allows test stub provider to exercise OpenAI retry handling', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const decision = decideImageRetry({
        error: new Error('openai[http_429]: rate limit'),
        taskType: TaskType.IMAGE,
        provider: 'stub',
        status: TaskStatus.RUNNING,
        retryCount: 0,
        firstRetryAt: null,
        retryUntil: null,
        retryWindowMs: 86_400_000,
        baseDelayMs: 10_000,
        maxDelayMs: 60_000,
        random: () => 0.5,
      });

      expect(decision.retryable).toBe(true);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('stops automatic retry after the retry window', () => {
    const decision = decideImageRetry({
      error: new Error('openai[http_502]: upstream request failed'),
      taskType: TaskType.IMAGE,
      provider: 'openai',
      status: TaskStatus.RUNNING,
      retryCount: 10,
      firstRetryAt: new Date('2026-06-03T10:00:00.000Z'),
      retryUntil: new Date('2026-06-03T11:00:00.000Z'),
      now: new Date('2026-06-03T11:00:00.000Z'),
      retryWindowMs: 86_400_000,
      baseDelayMs: 10_000,
      maxDelayMs: 60_000,
    });

    expect(decision).toEqual({ retryable: false, reason: 'retry_window_exhausted' });
  });
});
