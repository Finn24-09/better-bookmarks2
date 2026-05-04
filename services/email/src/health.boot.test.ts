import { describe, it, expect, vi, afterEach } from 'vitest';

// This file is deliberately isolated from `health.test.ts`. The boot
// scenario uses `vi.resetModules()` + `vi.doMock('./db.js', …)` to
// re-import a fresh copy of `health.js` with its own pool mock. Mixing
// that with the top-level `await import('./health.js')` in the sibling
// file made the suite reorder-fragile: any future shuffle of `describe`
// blocks could leave the top-level reference dangling against a
// cleared module cache. Keeping this scenario in its own file removes
// that hazard entirely.

describe('initial-boot failed ping', () => {
  function makeLogger() {
    return { warn: vi.fn(), info: vi.fn() };
  }

  afterEach(() => {
    // Belt-and-braces: even though each test calls vi.doUnmock and
    // vi.resetModules at the end, ensure no module-level mock leaks
    // across cases.
    vi.doUnmock('./db.js');
    vi.resetModules();
  });

  it('starts dbHealth.ok=true at module load and flips to false + warns on a failing first ping', async () => {
    // Pin down the actual production scenario: at boot the cached state
    // is optimistic-true (so /health doesn't false-503 before the first
    // ping has run), and if the very first SELECT 1 fails the warn log
    // MUST fire so operators can see why /health turns red.
    vi.resetModules();
    const freshMockQuery = vi.fn();
    vi.doMock('./db.js', () => ({ pool: { query: freshMockQuery } }));
    const fresh = await import('./health.js');

    // Default at module load — no setup, no manual write.
    expect(fresh.dbHealth.ok).toBe(true);

    const err = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    freshMockQuery.mockRejectedValueOnce(err);
    const logger = makeLogger();

    await fresh.pingDbOnce(logger);

    expect(fresh.dbHealth.ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const payload = logger.warn.mock.calls[0][0] as {
      err: { code?: string; message: string };
    };
    expect(payload.err.code).toBe('ECONNREFUSED');
    expect(payload.err.message).toContain('connection refused');
  });
});
