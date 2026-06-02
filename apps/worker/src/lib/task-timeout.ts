import { TaskType } from '@oneness/shared/enums';

type ImageTaskTimeoutOptions = {
  taskType: string;
  timeoutMs: number;
  controller: AbortController;
  onTimeout?: () => void;
};

export type ImageTaskTimeout = {
  timedOut: () => boolean;
  error: () => Error;
  dispose: () => void;
};

export function installImageTaskTimeout({
  taskType,
  timeoutMs,
  controller,
  onTimeout,
}: ImageTaskTimeoutOptions): ImageTaskTimeout {
  let didTimeout = false;
  let timer: NodeJS.Timeout | null = null;

  if (taskType === TaskType.IMAGE && timeoutMs > 0) {
    timer = setTimeout(() => {
      didTimeout = true;
      onTimeout?.();
      controller.abort();
    }, timeoutMs);
  }

  return {
    timedOut: () => didTimeout,
    error: () => new Error(`worker[timeout]: image task exceeded ${timeoutMs}ms`),
    dispose: () => {
      if (timer) clearTimeout(timer);
    },
  };
}
