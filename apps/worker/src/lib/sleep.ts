/**
 * Sleep for ms milliseconds, but reject early if the signal aborts.
 * The rejected error is named 'AbortError' to match WHATWG fetch convention.
 */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      const e = new Error('aborted');
      e.name = 'AbortError';
      return reject(e);
    }
    const t = setTimeout(() => resolve(), ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      },
      { once: true },
    );
  });
}
