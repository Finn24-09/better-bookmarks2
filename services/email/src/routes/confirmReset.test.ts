import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

const mockQuery   = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn());

vi.mock('../config.js', () => ({
  config: {
    JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long!',
    COOKIE_SECRET: 'cookie-secret-32-chars-minimum-test-only',
    NODE_ENV: 'test',
  },
}));

vi.mock('../db.js', () => ({
  pool: { connect: mockConnect, query: vi.fn() },
}));

const { confirmResetRoute } = await import('./confirmReset.js');

const VALID_USER = '00000000-0000-4000-8000-000000000001';
const STRONG_PW  = 'StrongPassword12!';

async function makeApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie, { secret: 'cookie-secret-32-chars-minimum-test-only' });
  await app.register(confirmResetRoute);
  return app;
}

describe('POST /confirm-reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
  });

  // ── S-7: plaintext password is passed to the SQL function (no bcryptjs) ──
  it('S-7: passes plaintext new_password to auth.reset_password_destroy_data (DB does the hashing)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: VALID_USER }] })       // redeem
      .mockResolvedValueOnce({ rows: [] })                                          // reset_password_destroy_data
      .mockResolvedValueOnce({ rows: [] });                                          // COMMIT

    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/confirm-reset',
      headers: { 'content-type': 'application/json', cookie: 'reset_token=raw-cookie-token' },
      body: JSON.stringify({ new_password: STRONG_PW }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // Find the call to reset_password_destroy_data and verify its 2nd parameter
    // is the PLAINTEXT password — never a bcrypt hash (which starts with $2).
    const resetCall = mockQuery.mock.calls.find(c => /reset_password_destroy_data/i.test(String(c[0])));
    expect(resetCall, 'reset_password_destroy_data was called').toBeDefined();
    const params = resetCall![1] as unknown[];
    expect(params[0]).toBe(VALID_USER);
    expect(params[1]).toBe(STRONG_PW);                  // plaintext, NOT a hash
    expect(String(params[1])).not.toMatch(/^\$2[aby]\$/);
  });

  // ── S-1: client.release() called when the transaction throws ──────────────
  it('S-1: client.release() is called when the transaction throws', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: VALID_USER }] })       // redeem
      .mockRejectedValueOnce(new Error('connection reset'))                          // reset throws
      .mockResolvedValueOnce({ rows: [] });                                          // ROLLBACK

    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/confirm-reset',
      headers: { 'content-type': 'application/json', cookie: 'reset_token=raw-cookie-token' },
      body: JSON.stringify({ new_password: STRONG_PW }),
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal error' });
    expect(mockRelease).toHaveBeenCalledOnce();
    const sql = mockQuery.mock.calls.map(c => String(c[0]));
    expect(sql.some(s => s.includes('ROLLBACK'))).toBe(true);
  });

  // ── S-1: invalid/expired token → 400 ─────────────────────────────────────
  it('S-1: invalid/expired token → 400 "Invalid request", no password update', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                  // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })     // redeem returns nothing
      .mockResolvedValueOnce({ rows: [] });                 // ROLLBACK

    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/confirm-reset',
      headers: { 'content-type': 'application/json', cookie: 'reset_token=raw-cookie-token' },
      body: JSON.stringify({ new_password: STRONG_PW }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid request' });
    const sql = mockQuery.mock.calls.map(c => String(c[0]));
    expect(sql.some(s => s.includes('reset_password_destroy_data'))).toBe(false);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // ── S-5: server-side min length aligned to 12 (matches sign_up + change_password) ──
  it('S-5: rejects passwords shorter than 12 characters', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/confirm-reset',
      headers: { 'content-type': 'application/json', cookie: 'reset_token=raw-cookie-token' },
      body: JSON.stringify({ new_password: 'Short11Char' }), // 11 chars
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid request' });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // ── S-1: missing cookie → 400 ────────────────────────────────────────────
  it('S-1: missing reset_token cookie → 400, pool.connect never called', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/confirm-reset',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ new_password: STRONG_PW }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid request' });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // ── S-1: success rotates token_version (calls reset_password_destroy_data) ─
  it('S-1: success path calls reset_password_destroy_data which rotates token_version', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ user_id: VALID_USER }] })       // redeem
      .mockResolvedValueOnce({ rows: [] })                                          // reset
      .mockResolvedValueOnce({ rows: [] });                                          // COMMIT

    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/confirm-reset',
      headers: { 'content-type': 'application/json', cookie: 'reset_token=raw-cookie-token' },
      body: JSON.stringify({ new_password: STRONG_PW }),
    });

    expect(res.statusCode).toBe(200);
    const sql = mockQuery.mock.calls.map(c => String(c[0]));
    // The SQL function increments token_version internally — we just verify it was called.
    expect(sql.some(s => s.includes('reset_password_destroy_data'))).toBe(true);
    expect(sql.some(s => s.includes('COMMIT'))).toBe(true);
    expect(sql.some(s => s.includes('ROLLBACK'))).toBe(false);
  });
});
