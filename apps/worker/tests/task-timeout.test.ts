import { describe, expect, it, vi } from 'vitest';
import { TaskType } from '@oneness/shared/enums';
import { installImageTaskTimeout } from '../src/lib/task-timeout.js';

describe('image task timeout', () => {
  it('aborts image tasks after the configured timeout', () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const onTimeout = vi.fn();
    const timeout = installImageTaskTimeout({
      taskType: TaskType.IMAGE,
      timeoutMs: 100,
      controller,
      onTimeout,
    });

    expect(controller.signal.aborted).toBe(false);

    vi.advanceTimersByTime(100);

    expect(controller.signal.aborted).toBe(true);
    expect(timeout.timedOut()).toBe(true);
    expect(timeout.error().message).toContain('worker[timeout]');
    expect(onTimeout).toHaveBeenCalledTimes(1);

    timeout.dispose();
    vi.useRealTimers();
  });

  it('does not install a timeout for non-image tasks', () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const onTimeout = vi.fn();
    const timeout = installImageTaskTimeout({
      taskType: TaskType.TEXT_ANALYZE,
      timeoutMs: 100,
      controller,
      onTimeout,
    });

    vi.advanceTimersByTime(100);

    expect(controller.signal.aborted).toBe(false);
    expect(timeout.timedOut()).toBe(false);
    expect(onTimeout).not.toHaveBeenCalled();

    timeout.dispose();
    vi.useRealTimers();
  });
});
