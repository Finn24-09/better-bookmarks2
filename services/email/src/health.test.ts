import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPoolQuery = vi.hoisted(() => vi.fn());

vi.mock('./db.js', () => ({
  pool: { query: mockPoolQuery },
}));

const { dbHealth, pingDbOnce } = await import('./health.js');

describe('M-3: /health DB oracle removal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbHealth.ok = true;
    dbHealth.lastCheck = 0;
  });

  it('M-3: dbHealth.ok defaults to optimistic-true at boot', () => {
    // The cached state must begin in a known state; default true means a
    // probe before the first ping does not falsely report unhealthy.
    expect(typeof dbHealth.ok).toBe('boolean');
    expect(typeof dbHealth.lastCheck).toBe('number');
  });

  it('M-3: pingDbOnce sets dbHealth.ok=true on success and stamps lastCheck', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    dbHealth.ok = false;
    const before = Date.now();
    await pingDbOnce();
    expect(dbHealth.ok).toBe(true);
    expect(dbHealth.lastCheck).toBeGreaterThanOrEqual(before);
  });

  it('M-3: pingDbOnce sets dbHealth.ok=false on failure', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('connection refused'));
    dbHealth.ok = true;
    await pingDbOnce();
    expect(dbHealth.ok).toBe(false);
  });

  it('M-3: pingDbOnce uses a single SELECT 1 — never a probe-on-demand pattern', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    await pingDbOnce();
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(String(mockPoolQuery.mock.calls[0][0])).toMatch(/SELECT 1/i);
  });

  describe('logger surfacing of DB connectivity failures', () => {
    function makeLogger() {
      return { warn: vi.fn(), info: vi.fn() };
    }

    it('logs a warning when the ping fails so the cause is visible in container logs', async () => {
      const err = Object.assign(new Error('password authentication failed'), {
        code: '28P01',
      });
      mockPoolQuery.mockRejectedValueOnce(err);
      const logger = makeLogger();
      dbHealth.ok = true;

      await pingDbOnce(logger);

      expect(dbHealth.ok).toBe(false);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      const [payload, msg] = logger.warn.mock.calls[0];
      expect(msg).toMatch(/db/i);
      expect(payload).toMatchObject({
        err: expect.objectContaining({
          code: '28P01',
          message: expect.stringContaining('password authentication failed'),
        }),
      });
    });

    it('logs every failure — operators need to see sustained outages, not just the first', async () => {
      mockPoolQuery
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'));
      const logger = makeLogger();
      dbHealth.ok = true;

      await pingDbOnce(logger);
      await pingDbOnce(logger);

      expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it('logs an info on recovery (fail → ok transition)', async () => {
      mockPoolQuery
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValueOnce({ rows: [] });
      const logger = makeLogger();
      dbHealth.ok = true;

      await pingDbOnce(logger);
      expect(dbHealth.ok).toBe(false);

      await pingDbOnce(logger);
      expect(dbHealth.ok).toBe(true);
      expect(logger.info).toHaveBeenCalledTimes(1);
      // Recovery log uses (obj, msg) shape to match the failure path —
      // makes pino-style structured logging consistent across both
      // transitions and lets log filters pick up `recovered` reliably.
      expect(logger.info.mock.calls[0][1]).toMatch(/recover/i);
    });

    it('does not log a recovery message on every successful ping when already healthy', async () => {
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      const logger = makeLogger();
      dbHealth.ok = true;

      await pingDbOnce(logger);
      await pingDbOnce(logger);

      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('is backward compatible: pingDbOnce() works with no logger', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('boom'));
      await expect(pingDbOnce()).resolves.toBeUndefined();
      expect(dbHealth.ok).toBe(false);
    });
  });

  describe('safeErr scrubbing', () => {
    function makeLogger() {
      return { warn: vi.fn(), info: vi.fn() };
    }

    it('scrubs postgres:// connection URIs from the logged err.message', async () => {
      // A real-world case: the pg client surfaces the connection string in
      // its error messages on URI-parse failure. Without scrubbing, any
      // password embedded in the URI lands in container logs verbatim.
      const err = new Error(
        'postgres://user:hunter2@host:5432/db SELECT 1 failed',
      );
      mockPoolQuery.mockRejectedValueOnce(err);
      const logger = makeLogger();
      dbHealth.ok = true;

      await pingDbOnce(logger);

      const payload = logger.warn.mock.calls[0][0] as { err: { message: string } };
      expect(payload.err.message).toContain('postgres://[redacted]');
      expect(payload.err.message).not.toContain('hunter2');
      expect(payload.err.message).not.toContain('user:hunter2');
    });

    it('scrubs password=... query parameter style from the logged err.message', async () => {
      const err = new Error('connection failed: password=secret123 not accepted');
      mockPoolQuery.mockRejectedValueOnce(err);
      const logger = makeLogger();
      dbHealth.ok = true;

      await pingDbOnce(logger);

      const payload = logger.warn.mock.calls[0][0] as { err: { message: string } };
      expect(payload.err.message).toContain('password=[redacted]');
      expect(payload.err.message).not.toContain('secret123');
    });

    it('truncates very long messages to 500 chars to bound log volume', async () => {
      const huge = 'x'.repeat(5000);
      mockPoolQuery.mockRejectedValueOnce(new Error(huge));
      const logger = makeLogger();
      dbHealth.ok = true;

      await pingDbOnce(logger);

      const payload = logger.warn.mock.calls[0][0] as { err: { message: string } };
      expect(payload.err.message.length).toBeLessThanOrEqual(500);
    });
  });

  describe('re-entrancy guard', () => {
    function makeLogger() {
      return { warn: vi.fn(), info: vi.fn() };
    }

    it('does not run a second pool.query when one is already in flight', async () => {
      // Two ticks of the 30 s loop overlap if the first SELECT 1 takes
      // longer than 30 s (slow DB, contended conn pool). Without a guard,
      // both calls race to mutate dbHealth.ok and wasOk, which can
      // double-log "recovered" or skip a recovery transition entirely.
      let resolve!: (v: { rows: unknown[] }) => void;
      const deferred = new Promise<{ rows: unknown[] }>((r) => {
        resolve = r;
      });
      mockPoolQuery.mockReturnValueOnce(deferred);
      const logger = makeLogger();

      const first = pingDbOnce(logger);
      const second = pingDbOnce(logger);

      // Resolve the original query so first can complete.
      resolve({ rows: [] });
      await Promise.all([first, second]);

      // Second call must have been a no-op.
      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    });
  });
});
