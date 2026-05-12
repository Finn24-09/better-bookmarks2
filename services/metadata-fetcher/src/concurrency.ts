// Counting semaphore used by the route handler to cap concurrent outbound
// fetches (global cap to defeat slowloris; per-user cap to defeat amplification
// via a single authenticated user). Plain in-memory primitive — there is only
// one process per container; horizontal scaling needs a distributed limiter.

export class Semaphore {
  private acquired = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error('Semaphore capacity must be >= 1');
  }

  get inFlight(): number {
    return this.acquired;
  }

  /** Resolves once a slot is free. Always pair with a release(). */
  acquire(): Promise<void> {
    if (this.acquired < this.capacity) {
      this.acquired++;
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this.waiters.push(() => {
        this.acquired++;
        resolve();
      });
    });
  }

  /** Returns true and reserves a slot, or false if no slot is available. Never blocks. */
  tryAcquire(): boolean {
    if (this.acquired < this.capacity) {
      this.acquired++;
      return true;
    }
    return false;
  }

  release(): void {
    if (this.acquired === 0) {
      throw new Error('Semaphore release without matching acquire (double-release bug)');
    }
    this.acquired--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

/**
 * Per-key semaphores keyed by user id. Lazily created; released entries are
 * garbage-collected when their inFlight count returns to zero and there are
 * no waiters — otherwise long-lived users would leak Semaphore instances.
 */
export class PerKeySemaphore {
  private readonly perKey = new Map<string, Semaphore>();

  constructor(private readonly perKeyCapacity: number) {}

  async acquire(key: string): Promise<void> {
    let sem = this.perKey.get(key);
    if (!sem) {
      sem = new Semaphore(this.perKeyCapacity);
      this.perKey.set(key, sem);
    }
    await sem.acquire();
  }

  tryAcquire(key: string): boolean {
    let sem = this.perKey.get(key);
    if (!sem) {
      sem = new Semaphore(this.perKeyCapacity);
      this.perKey.set(key, sem);
    }
    return sem.tryAcquire();
  }

  release(key: string): void {
    const sem = this.perKey.get(key);
    if (!sem) {
      throw new Error(`PerKeySemaphore release for unknown key`);
    }
    sem.release();
    // GC entry once idle and no waiters.
    if (sem.inFlight === 0) this.perKey.delete(key);
  }
}
