import { describe, it, expect } from 'vitest';
import { Semaphore, PerKeySemaphore } from './concurrency.js';

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

describe('PerKeySemaphore', () => {
  it('isolates capacity per key', () => {
    const sem = new PerKeySemaphore(1);
    expect(sem.tryAcquire('a')).toBe(true);
    expect(sem.tryAcquire('a')).toBe(false);
    expect(sem.tryAcquire('b')).toBe(true);
    sem.release('a');
    sem.release('b');
  });

  it('GCs the per-key Semaphore once idle', () => {
    const sem = new PerKeySemaphore(2);
    sem.tryAcquire('alice');
    sem.tryAcquire('alice');
    sem.release('alice');
    sem.release('alice');
    // Re-acquire after full release should hit a fresh internal Semaphore;
    // exercise it to make sure the GC didn't break anything.
    expect(sem.tryAcquire('alice')).toBe(true);
    sem.release('alice');
  });

  it('release-then-waiter-resume keeps the semaphore alive (no orphaned waiters)', async () => {
    const sem = new PerKeySemaphore(1);
    expect(sem.tryAcquire('alice')).toBe(true);
    let resolved = false;
    const waiterPromise = sem.acquire('alice').then(() => { resolved = true; });
    await Promise.resolve();  // queue the waiter
    sem.release('alice');     // hands the slot to the waiter
    await waiterPromise;
    expect(resolved).toBe(true);
    // The waiter is now holding the slot. A second waiter on the same key
    // MUST still queue against the same semaphore (i.e. tryAcquire returns
    // false), proving the semaphore was not GC'd between release and
    // resume.
    expect(sem.tryAcquire('alice')).toBe(false);
    sem.release('alice');
  });

  it('throws on release for unknown key', () => {
    const sem = new PerKeySemaphore(1);
    expect(() => sem.release('nobody')).toThrow(/unknown key/);
  });
});
