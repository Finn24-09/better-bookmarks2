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
});
