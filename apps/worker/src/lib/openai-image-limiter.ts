type QueueEntry<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
};

export class AsyncRateLimiter {
  private active = 0;
  private lastStartAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly queue: QueueEntry<unknown>[] = [];

  constructor(
    private readonly maxConcurrency: number,
    private readonly minIntervalMs: number,
  ) {}

  schedule<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        run,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.drain();
    });
  }

  private drain() {
    if (this.timer) return;
    if (this.active >= this.maxConcurrency) return;
    const next = this.queue.shift();
    if (!next) return;

    const waitMs = Math.max(0, this.lastStartAt + this.minIntervalMs - Date.now());
    if (waitMs > 0) {
      this.queue.unshift(next);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, waitMs);
      return;
    }

    this.active += 1;
    this.lastStartAt = Date.now();
    void next.run()
      .then(next.resolve, next.reject)
      .finally(() => {
        this.active -= 1;
        this.drain();
      });

    this.drain();
  }
}
