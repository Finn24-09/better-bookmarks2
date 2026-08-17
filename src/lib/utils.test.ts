import { describe, it, expect } from 'vitest';
import { runWithConcurrency, chunk, isAbortError, isRetryableError, withRetry } from './utils';
import { ApiError } from './api';

describe('runWithConcurrency', () => {
  it('processes every item exactly once', async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], async (n) => {
      seen.push(n);
    }, 2);

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not exceed the concurrency cap', async () => {
    let inFlight = 0;
    let peak = 0;

    const worker = async (_n: number) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    };

    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], worker, 3);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('caps the worker pool at items.length when concurrency > items.length', async () => {
    let workerStarts = 0;
    await runWithConcurrency([1], async () => {
      workerStarts++;
    }, 10);

    // Only one item → only one worker invocation total.
    expect(workerStarts).toBe(1);
  });

  it('resolves immediately on empty items', async () => {
    let called = 0;
    await runWithConcurrency<number>([], async () => {
      called++;
    }, 3);

    expect(called).toBe(0);
  });

  it('propagates a worker rejection by rejecting the whole call', async () => {
    const worker = async (n: number) => {
      if (n === 3) throw new Error('boom');
    };

    await expect(runWithConcurrency([1, 2, 3, 4], worker, 2)).rejects.toThrow('boom');
  });

  it('rejects with AbortError when signal is already aborted before the call', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let workerCalls = 0;

    const promise = runWithConcurrency(
      [1, 2, 3],
      async () => {
        workerCalls++;
      },
      2,
      ctrl.signal,
    );

    await expect(promise).rejects.toThrow(DOMException);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    // No worker should have been invoked because the abort check fires
    // BEFORE every iteration's worker call.
    expect(workerCalls).toBe(0);
  });

  it('rejects with AbortError when signal is aborted mid-run', async () => {
    const ctrl = new AbortController();
    let started = 0;

    const worker = async (_n: number) => {
      started++;
      if (started === 2) ctrl.abort();
      await new Promise((r) => setTimeout(r, 1));
    };

    const promise = runWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], worker, 1, ctrl.signal);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    // The worker that triggered the abort already completed, but later
    // workers must NOT have started.
    expect(started).toBeLessThan(10);
  });

  it('lets an in-flight worker complete before abort propagates', async () => {
    const ctrl = new AbortController();
    let inFlightCompleted = 0;

    const worker = async (n: number) => {
      if (n === 1) {
        // Abort while this worker is still running.
        ctrl.abort();
        await new Promise((r) => setTimeout(r, 5));
        inFlightCompleted++;
        return;
      }
      await new Promise((r) => setTimeout(r, 1));
    };

    const promise = runWithConcurrency([1, 2, 3], worker, 1, ctrl.signal);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });

    // The worker for item 1 was awaited to completion before the next
    // iteration's abort check fired — verifies the await/abort ordering
    // contract that callers rely on for atomic per-item operations.
    expect(inFlightCompleted).toBe(1);
  });
});

describe('chunk', () => {
  it('splits into fixed-size groups with a short final group', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns an empty array for no items', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('returns a single group when size exceeds the item count', () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
});

describe('isAbortError', () => {
  it('recognises a DOMException abort', () => {
    // DOMException does not inherit from Error in every environment we run in
    // (notably jsdom), so an instanceof check would misclassify a cancellation
    // as a transport failure.
    expect(isAbortError(new DOMException('cancelled', 'AbortError'))).toBe(true);
  });

  it('does not treat an unrelated error as an abort', () => {
    expect(isAbortError(new Error('boom'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});

describe('isRetryableError', () => {
  it('treats rate limiting and server faults as retryable', () => {
    expect(isRetryableError(new ApiError(429, 'slow down'))).toBe(true);
    expect(isRetryableError(new ApiError(500, 'oops'))).toBe(true);
    expect(isRetryableError(new ApiError(503, 'unavailable'))).toBe(true);
  });

  it('treats a fetch network failure as retryable', () => {
    // Browsers reject fetch with a TypeError on DNS/connection failures.
    expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('treats client errors and plain failures as permanent', () => {
    expect(isRetryableError(new ApiError(404, 'gone'))).toBe(false);
    expect(isRetryableError(new ApiError(400, 'bad'))).toBe(false);
    expect(isRetryableError(new Error('boom'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns the result without retrying when the call succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      return 'ok';
    }, { attempts: 3, baseMs: 1 });

    expect(result).toBe('ok');
    expect(attempts).toBe(1);
  });

  it('retries a retryable failure and returns the eventual success', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw new ApiError(429, 'slow down');
      return 'ok';
    }, { attempts: 3, baseMs: 1 });

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('gives up after the configured attempts and rethrows', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new ApiError(429, 'slow down');
      }, { attempts: 2, baseMs: 1 }),
    ).rejects.toThrow('slow down');

    expect(attempts).toBe(2);
  });

  it('does not retry a permanent failure', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw new Error('permanent');
      }, { attempts: 5, baseMs: 1 }),
    ).rejects.toThrow('permanent');

    expect(attempts).toBe(1);
  });

  it('caps the per-attempt backoff at maxDelayMs', async () => {
    const delays: number[] = [];
    let last = Date.now();
    let attempts = 0;

    await expect(
      withRetry(async () => {
        if (attempts > 0) delays.push(Date.now() - last);
        last = Date.now();
        attempts++;
        throw new ApiError(429, 'slow down');
      }, { attempts: 5, baseMs: 40, maxDelayMs: 60 }),
    ).rejects.toThrow('slow down');

    // Uncapped this would double to 40, 80, 160, 320 ms. The cap matters
    // because the api_read bucket needs many seconds to drain, so a caller
    // needs many attempts rather than a few enormous sleeps.
    expect(attempts).toBe(5);
    for (const d of delays) {
      expect(d).toBeLessThan(60 + 40 + 60); // cap + max jitter + scheduler slack
    }
  });

  it('interrupts the backoff wait when the signal aborts', async () => {
    const ctrl = new AbortController();
    await expect(
      withRetry(async () => {
        ctrl.abort();
        throw new ApiError(429, 'slow down');
      }, { attempts: 3, baseMs: 60_000, signal: ctrl.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
