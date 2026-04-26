import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const mockPoolQuery = vi.hoisted(() => vi.fn());
const mockSendMail  = vi.hoisted(() => vi.fn());

vi.mock('../config.js', () => ({
  config: {
    APP_BASE_URL: 'https://example.test',
  },
}));

vi.mock('../db.js', () => ({
  pool: { query: mockPoolQuery, connect: vi.fn() },
}));

vi.mock('../mailer.js', () => ({
  sendMail: mockSendMail,
}));

const { requestResetRoute } = await import('./requestReset.js');

function makeApp() {
  const app = Fastify({ logger: false });
  app.register(requestResetRoute);
  return app;
}

describe('POST /request-reset', () => {
  beforeEach(() => {
    // resetAllMocks() drops pending mockResolvedValueOnce queues so they
    // do not bleed into the next test (clearAllMocks keeps the queue).
    vi.resetAllMocks();
    mockSendMail.mockResolvedValue(undefined);
  });

  // ── S-1: 800ms timing floor fires even when sendMail throws ──────────────
  it('S-1: 800ms timing floor fires when sendMail throws', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'u1', email: 'a@b.c' }] }) // user lookup
      .mockResolvedValueOnce({ rows: [] });                                          // upsert_email_token
    mockSendMail.mockRejectedValueOnce(new Error('SMTP down'));

    const start = Date.now();
    const res = await makeApp().inject({
      method: 'POST',
      url: '/request-reset',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.c' }),
    });
    const elapsed = Date.now() - start;

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(elapsed).toBeGreaterThanOrEqual(780); // small jitter tolerance below 800
  });

  // ── S-1: non-existent email still returns 200 (no enumeration) ───────────
  it('S-1: non-existent email returns 200, no token created, no email sent', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await makeApp().inject({
      method: 'POST',
      url: '/request-reset',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@nowhere.test' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockSendMail).not.toHaveBeenCalled();
    const sql = mockPoolQuery.mock.calls.map(c => String(c[0])).join('\n');
    expect(sql).not.toMatch(/upsert_email_token/i);
  });

  // ── S-1: constant-time response — found and not-found are similar ────────
  it('S-1: response time is similar for found and not-found (timing floor)', async () => {
    // Found case
    mockPoolQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'u1', email: 'a@b.c' }] })
      .mockResolvedValueOnce({ rows: [] });
    const t1 = Date.now();
    await makeApp().inject({
      method: 'POST', url: '/request-reset',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.c' }),
    });
    const foundElapsed = Date.now() - t1;

    // Not-found case
    vi.clearAllMocks();
    mockSendMail.mockResolvedValue(undefined);
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const t2 = Date.now();
    await makeApp().inject({
      method: 'POST', url: '/request-reset',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@nowhere.test' }),
    });
    const notFoundElapsed = Date.now() - t2;

    // Both should be at or above the 800ms floor.
    expect(foundElapsed).toBeGreaterThanOrEqual(780);
    expect(notFoundElapsed).toBeGreaterThanOrEqual(780);
  });

  // ── S-1: invalid email body still returns 200 + floor ────────────────────
  it('S-1: invalid email returns 200 (no enumeration), no DB lookup', async () => {
    const start = Date.now();
    const res = await makeApp().inject({
      method: 'POST',
      url: '/request-reset',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    const elapsed = Date.now() - start;

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(elapsed).toBeGreaterThanOrEqual(780);
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
