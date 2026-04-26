import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { SignJWT } from 'jose';
import { createSecretKey } from 'node:crypto';

const mockPoolQuery = vi.hoisted(() => vi.fn());
const mockSendMail  = vi.hoisted(() => vi.fn());

vi.mock('../config.js', () => ({
  config: { JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long!' },
}));

vi.mock('../db.js', () => ({
  pool: { query: mockPoolQuery, connect: vi.fn() },
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

// Wait one microtask + one IO tick so the fire-and-forget
// then-chain can flush before assertions.
const flush = () => new Promise(r => setImmediate(r));

describe('POST /notify-password-change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMail.mockResolvedValue(undefined);
  });

  // ── S-1: valid token → 200, email sent fire-and-forget ───────────────────
  it('S-1: valid token → 200 immediately, email sent fire-and-forget', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'a@b.c' }] });

    const res = await makeApp().inject({
      method: 'POST',
      url: '/notify-password-change',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await flush();
    expect(mockSendMail).toHaveBeenCalledOnce();
  });

  // ── S-1: missing Authorization header → 401, no DB lookup ────────────────
  it('S-1: missing Authorization header → 401, no DB lookup, no email', async () => {
    const res = await makeApp().inject({
      method: 'POST',
      url: '/notify-password-change',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Unauthorized' });
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
    expect(mockPoolQuery).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  // ── S-1: no information leakage on missing user (still 200) ──────────────
  it('S-1: no email leakage when user row vanished — still 200, no sendMail', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await makeApp().inject({
      method: 'POST',
      url: '/notify-password-change',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(200);
    await flush();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  // ── S-1: DB error in fire-and-forget chain does not affect response ──────
  it('S-1: DB error after response is logged, response is still 200', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('DB down'));

    const res = await makeApp().inject({
      method: 'POST',
      url: '/notify-password-change',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await flush();
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
