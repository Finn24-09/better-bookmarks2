/**
 * Run `worker` for each item in `items`, with at most `concurrency`
 * in-flight at once. Uses a shared index so workers self-balance.
 */
export async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency: number,
  signal?: AbortSignal,
): Promise<void> {
  let index = 0;

  async function drain(): Promise<void> {
    while (index < items.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const i = index++;
      await worker(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, drain),
  );
}
