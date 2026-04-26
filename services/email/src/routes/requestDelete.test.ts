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

const { requestDeleteRoute } = await import('./requestDelete.js');

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long!';
const secretKey = createSecretKey(Buffer.from(SECRET, 'utf-8'));
const VALID_USER = '00000000-0000-4000-8000-000000000001';
const OTHER_USER = '00000000-0000-4000-8000-000000000002';

async function makeToken(userId = VALID_USER): Promise<string> {
  return new SignJWT({ sub: userId, role: 'app_user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secretKey);
}

function makeApp() {
  const app = Fastify({ logger: false });
  app.register(requestDeleteRoute);
  return app;
}

describe('POST /request-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
    mockSendMail.mockResolvedValue(undefined);
  });

  // ── S-6: cooldown not consumed on send failure ───────────────────────────
  it('S-6: failed sendMail does NOT commit the email_send_log INSERT (cooldown not consumed)', async () => {
    // Sequence: BEGIN → user SELECT → upsert_email_token → INSERT log → ROLLBACK on send failure.
    // The request fails (500) but the log INSERT is rolled back so the user can retry.
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'a@b.c' }] })           // user SELECT
      .mockResolvedValueOnce({ rows: [] })                                          // upsert_email_token
      .mockResolvedValueOnce({ rows: [] })                                          // INSERT log
      .mockResolvedValueOnce({ rows: [] });                                          // ROLLBACK
    mockSendMail.mockRejectedValueOnce(new Error('SMTP down'));

    const res = await makeApp().inject({
      method: 'POST',
      url: '/request-delete',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal error' });
    const sql = mockQuery.mock.calls.map(c => String(c[0]));
    // S-6: the INSERT must NOT have been COMMITed; ROLLBACK must have run.
    expect(sql.some(s => s.includes('ROLLBACK'))).toBe(true);
    expect(sql.some(s => s.includes('COMMIT'))).toBe(false);
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  // ── S-1: success path commits log + sends email ──────────────────────────
  it('S-1: success path commits and sends', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                          // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'a@b.c' }] })           // user
      .mockResolvedValueOnce({ rows: [] })                                          // upsert
      .mockResolvedValueOnce({ rows: [] })                                          // INSERT log
      .mockResolvedValueOnce({ rows: [] });                                          // COMMIT

    const res = await makeApp().inject({
      method: 'POST',
      url: '/request-delete',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mockSendMail).toHaveBeenCalledOnce();
    const sql = mockQuery.mock.calls.map(c => String(c[0]));
    expect(sql.some(s => s.includes('COMMIT'))).toBe(true);
    expect(sql.some(s => s.includes('ROLLBACK'))).toBe(false);
  });

  // ── S-1: cross-user safety — non-existent user → 404 ─────────────────────
  it('S-1: non-existent user → 404, no token created, no email sent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                  // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })     // user not found
      .mockResolvedValueOnce({ rows: [] });                 // ROLLBACK

    const res = await makeApp().inject({
      method: 'POST',
      url: '/request-delete',
      headers: { authorization: `Bearer ${await makeToken(OTHER_USER)}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
    expect(mockSendMail).not.toHaveBeenCalled();
    const sql = mockQuery.mock.calls.map(c => String(c[0]));
    expect(sql.some(s => s.includes('upsert_email_token'))).toBe(false);
    expect(sql.some(s => s.includes('email_send_log'))).toBe(false);
  });

  // ── S-1: missing Authorization header → 401 ──────────────────────────────
  it('S-1: missing Authorization header → 401, pool.connect never called', async () => {
    const res = await makeApp().inject({
      method: 'POST',
      url: '/request-delete',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Unauthorized' });
    expect(mockConnect).not.toHaveBeenCalled();
  });
});
