import { describe, it, expect } from 'vitest';
import { Semaphore } from './concurrency.js';

describe('Semaphore', () => {
  it('acquire returns immediately under cap', async () => {
    const sem = new Semaphore(2);
    const t1 = sem.acquire();
    const t2 = sem.acquire();
    await expect(Promise.race([t1, new Promise(r => setTimeout(() => r('timeout'), 50))])).resolves.toBeUndefined();
    await expect(Promise.race([t2, new Promise(r => setTimeout(() => r('timeout'), 50))])).resolves.toBeUndefined();
  });

  it('acquire past cap awaits', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    let resolved = false;
    const pending = sem.acquire().then(() => { resolved = true; });
    await new Promise(r => setTimeout(r, 50));
    expect(resolved).toBe(false);
    sem.release();
    await pending;
    expect(resolved).toBe(true);
  });

  it('release wakes a waiter', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    const order: string[] = [];
    const w1 = sem.acquire().then(() => { order.push('w1'); });
    sem.release();
    await w1;
    expect(order).toEqual(['w1']);
  });

  it('tryAcquire returns true when available, false when full', () => {
    const sem = new Semaphore(2);
    expect(sem.tryAcquire()).toBe(true);
    expect(sem.tryAcquire()).toBe(true);
    expect(sem.tryAcquire()).toBe(false);
  });

  it('release past zero throws (catches double-release bugs)', () => {
    const sem = new Semaphore(2);
    expect(() => sem.release()).toThrow();
  });

  it('inFlight reports current acquired count', async () => {
    const sem = new Semaphore(3);
    expect(sem.inFlight).toBe(0);
    await sem.acquire();
    expect(sem.inFlight).toBe(1);
    await sem.acquire();
    expect(sem.inFlight).toBe(2);
    sem.release();
    expect(sem.inFlight).toBe(1);
  });
});
