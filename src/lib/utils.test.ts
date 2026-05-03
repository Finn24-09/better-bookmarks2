import { describe, it, expect } from 'vitest';
import { runWithConcurrency } from './utils';

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
