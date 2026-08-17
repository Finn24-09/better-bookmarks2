import { ApiError } from './api';

/** Split `items` into consecutive groups of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Matches on `name` rather than `instanceof Error` because aborts arrive as
// DOMException, which does not inherit from Error in every environment we run
// in (notably jsdom) — an instanceof check silently reclassifies a cancelled
// operation as a transport failure.
export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

/**
 * True for transport conditions that say nothing about the request's validity
 * and may succeed on a later attempt: rate limiting, server-side faults, and
 * network failures (browsers reject `fetch` with a TypeError for those).
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 429 || err.status >= 500;
  return err instanceof TypeError;
}

/** Random 0..baseMs jitter so concurrent callers do not retry in lockstep. */
function jitterMs(baseMs: number): number {
  const buf = new Uint8Array(1);
  crypto.getRandomValues(buf);
  return Math.floor((buf[0] / 256) * baseMs);
}

/** Sleep that rejects immediately when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts: number;
  /** Base backoff in ms; doubles each attempt, plus jitter. */
  baseMs: number;
  /**
   * Ceiling on the doubling, in ms. Clearing a long rate-limit queue needs many
   * attempts rather than a few enormous sleeps — uncapped doubling reaches
   * double-digit seconds by attempt 5, which reads as a hung UI.
   */
  maxDelayMs?: number;
  signal?: AbortSignal;
}

/**
 * Run `fn`, retrying only transient failures with exponential backoff.
 *
 * Nginx's `api_read` zone drains at 1 request/second, so callers that can trip
 * it should pass a baseMs of several hundred ms — a sub-second retry is certain
 * to be rejected again.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { attempts, baseMs, maxDelayMs = Infinity, signal } = options;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isAbortError(err) || !isRetryableError(err) || attempt >= attempts) throw err;
      const backoff = Math.min(baseMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(backoff + jitterMs(baseMs), signal);
    }
  }
}

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
