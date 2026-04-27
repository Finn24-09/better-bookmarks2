import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { SignJWT } from 'jose';
import { createSecretKey } from 'node:crypto';

const mockQuery     = vi.hoisted(() => vi.fn());
const mockRelease   = vi.hoisted(() => vi.fn());
const mockConnect   = vi.hoisted(() => vi.fn());
const mockPoolQuery = vi.hoisted(() => vi.fn());
const mockSendMail  = vi.hoisted(() => vi.fn());

vi.mock('../config.js', () => ({
  config: { JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long!' },
}));

vi.mock('../db.js', () => ({
  pool: { connect: mockConnect, query: mockPoolQuery },
}));

vi.mock('../mailer.js', () => ({
  sendMail: mockSendMail,
}));

const { notifyPasswordChangeRoute } = await import('./notifyPasswordChange.js');

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long!';
const secretKey = createSecretKey(Buffer.from(SECRET, 'utf-8'));
const VALID_USER = '00000000-0000-4000-8000-000000000001';

async function makeToken(userId = VALID_USER, opts: { exp?: string; role?: string } = {}): Promise<string> {
  const j = new SignJWT({ sub: userId, role: opts.role ?? 'app_user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(opts.exp ?? '1h');
  return j.sign(secretKey);
}

function makeApp() {
  const app = Fastify({ logger: false });
  app.register(notifyPasswordChangeRoute);
  return app;
}

describe('POST /notify-password-change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
    mockSendMail.mockResolvedValue(undefined);
  });

  // ── S-1: valid token → 200, email sent within request lifecycle ──────────
  it('S-1: valid token → 200, email sent within request lifecycle', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                  // BEGIN
      .mockResolvedValueOnce({ rows: [] })                                  // advisory lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                     // cooldown
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'a@b.c' }] })   // user
      .mockResolvedValueOnce({ rows: [] })                                  // INSERT log
      .mockResolvedValueOnce({ rows: [] });                                 // COMMIT

    const res = await makeApp().inject({
      method: 'POST',
      url: '/notify-password-change',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockSendMail).toHaveBeenCalledOnce();
    const sql = mockQuery.mock.calls.map(c => String(c[0]));
    expect(sql.some(s => s.includes('COMMIT'))).toBe(true);
    expect(sql.some(s => /INSERT INTO auth\.email_send_log/i.test(s))).toBe(true);
  });

  // ── S-1: missing Authorization header → 401, no DB lookup ────────────────
  it('S-1: missing Authorization header → 401, pool.connect never called', async () => {
    const res = await makeApp().inject({
      method: 'POST',
      url: '/notify-password-change',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Unauthorized' });
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  // ── S-1: invalid signature (wrong secret) → 401 ──────────────────────────
  it('S-1: token signed with wrong secret → 401', async () => {
    const badKey = createSecretKey(Buffer.from('a-different-secret-thats-also-32-chars!', 'utf-8'));
    const badToken = await new SignJWT({ sub: VALID_USER, role: 'app_user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(badKey);

    const res = await makeApp().inject({
      method: 'POST',
      url: '/notify-password-change',
      headers: { authorization: `Bearer ${badToken}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(401);
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  // ── S-1: no leakage when user row vanished — still 200, ROLLBACK, no send ─
  it('S-1: no email leakage when user row vanished — 200, ROLLBACK, no sendMail', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                  // BEGIN
      .mockResolvedValueOnce({ rows: [] })                  // advisory lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })     // cooldown
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })     // user not found
      .mockResolvedValueOnce({ rows: [] });                 // ROLLBACK

    const res = await makeApp().inject({
      method: 'POST',
      url: '/notify-password-change',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockSendMail).not.toHaveBeenCalled();
    const sql = mockQuery.mock.calls.map(c => String(c[0]));
    expect(sql.some(s => s.includes('ROLLBACK'))).toBe(true);
    expect(sql.some(s => /INSERT INTO auth\.email_send_log/i.test(s))).toBe(false);
    expect(sql.some(s => s.includes('COMMIT'))).toBe(false);
  });

  // ── S-5: DB error → 500, sendMail not called ─────────────────────────────
  it('S-5: DB error → 500 returned, sendMail not called', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                  // BEGIN
      .mockRejectedValueOnce(new Error('DB down'))          // advisory lock fails
      .mockResolvedValueOnce({ rows: [] });                 // ROLLBACK in catch

    const res = await makeApp().inject({
      method: 'POST',
      url: '/notify-password-change',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal error' });
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // ── S-4: cooldown hit → silent 200, no INSERT, no sendMail ───────────────
  it('S-4: cooldown hit → 200 ok:true (silent), no sendMail, no INSERT into email_send_log', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                 // BEGIN
      .mockResolvedValueOnce({ rows: [] })                                 // advisory lock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })   // cooldown HIT
      .mockResolvedValueOnce({ rows: [] });                                // ROLLBACK

    const res = await makeApp().inject({
      method: 'POST',
      url: '/notify-password-change',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockSendMail).not.toHaveBeenCalled();
    const sql = mockQuery.mock.calls.map(c => String(c[0]));
    expect(sql.some(s => /INSERT INTO auth\.email_send_log/i.test(s))).toBe(false);
    expect(sql.some(s => s.includes('ROLLBACK'))).toBe(true);
    expect(sql.some(s => s.includes('COMMIT'))).toBe(false);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // ── S-5: sendMail throws → ROLLBACK, no committed log row, 500 ───────────
  it('S-5: sendMail throws → ROLLBACK, no email_send_log INSERT committed, 500 returned', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                  // BEGIN
      .mockResolvedValueOnce({ rows: [] })                                  // advisory lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                     // cooldown
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'a@b.c' }] })   // user
      .mockResolvedValueOnce({ rows: [] })                                  // INSERT log
      .mockResolvedValueOnce({ rows: [] });                                 // ROLLBACK
    mockSendMail.mockRejectedValueOnce(new Error('SMTP down'));

    const res = await makeApp().inject({
      method: 'POST',
      url: '/notify-password-change',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal error' });

    const sql = mockQuery.mock.calls.map(c => String(c[0]));
    expect(sql.some(s => s.includes('ROLLBACK'))).toBe(true);
    expect(sql.some(s => s.includes('COMMIT'))).toBe(false);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // ── S-4: advisory lock keyed by userId with the right prefix ─────────────
  it('S-4: advisory lock acquired with hashtext(\'notify_password_change:\' || userId)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                  // BEGIN
      .mockResolvedValueOnce({ rows: [] })                                  // advisory lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                     // cooldown
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'a@b.c' }] })   // user
      .mockResolvedValueOnce({ rows: [] })                                  // INSERT log
      .mockResolvedValueOnce({ rows: [] });                                 // COMMIT

    const res = await makeApp().inject({
      method: 'POST',
      url: '/notify-password-change',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(200);

    const lockCall = mockQuery.mock.calls.find(c => /pg_advisory_xact_lock/i.test(String(c[0])));
    expect(lockCall, 'route issued a pg_advisory_xact_lock call').toBeDefined();
    expect(String(lockCall![0])).toMatch(/notify_password_change:/);
    // The userId must be passed as a parameter, never interpolated into SQL.
    expect((lockCall![1] as unknown[]).some(p => p === VALID_USER)).toBe(true);
    expect(String(lockCall![0])).not.toContain(VALID_USER);
  });
});
