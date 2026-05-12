import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { SignJWT } from 'jose';
import { createSecretKey } from 'node:crypto';
import { rateLimitConfig } from '../rateLimit.js';

// Hoist mock fns so vi.mock factories see them.
const mockConnect    = vi.hoisted(() => vi.fn());
const mockQuery      = vi.hoisted(() => vi.fn());
const mockRelease    = vi.hoisted(() => vi.fn());
const mockPoolQuery  = vi.hoisted(() => vi.fn());

vi.mock('../config.js', () => ({
  config: {
    JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long!',
    JWT_AUDIENCE: 'email-svc',
    JWT_ISSUER: undefined,
  },
}));

vi.mock('../db.js', () => ({
  pool: { connect: mockConnect, query: mockPoolQuery },
}));

const { refreshAfterVerifyRoute } = await import('./refreshAfterVerify.js');

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long!';
const secretKey = createSecretKey(Buffer.from(SECRET, 'utf-8'));
const VALID_USER  = '00000000-0000-4000-8000-000000000001';
const SECOND_USER = '00000000-0000-4000-8000-000000000002';

async function makeToken(
  userId: string = VALID_USER,
  extra: Record<string, unknown> = {},
): Promise<string> {
  return new SignJWT({ sub: userId, role: 'app_user', aud: ['email-svc'], ...extra })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(secretKey);
}

function makeApp() {
  const app = Fastify({ logger: false });
  // Register the rate-limit plugin so the route's rateLimit config is honoured.
  app.register(rateLimit, rateLimitConfig.global);
  app.register(refreshAfterVerifyRoute);
  return app;
}

describe('POST /refresh-after-verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
  });

  it('returns 200 with token + email_verified:true on a successful mint', async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ token: 'new.jwt.value', email_verified: true }],
    });
    const res = await makeApp().inject({
      method: 'POST',
      url: '/refresh-after-verify',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ token: 'new.jwt.value', email_verified: true });
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(String(sql)).toMatch(/auth\.mint_post_verify_jwt\s*\(\s*\$1\s*\)/i);
    expect(params).toEqual([VALID_USER]);
  });

  it('returns 410 Gone when the DB function raises check_violation (verification too old / not verified)', async () => {
    const err = Object.assign(new Error('verification window expired'), { code: '23514' });
    mockPoolQuery.mockRejectedValueOnce(err);
    const res = await makeApp().inject({
      method: 'POST',
      url: '/refresh-after-verify',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ error: 'Verification window expired' });
  });

  it('returns 410 Gone when the user row is not found (no_data_found SQLSTATE)', async () => {
    const err = Object.assign(new Error('user not found'), { code: 'P0002' });
    mockPoolQuery.mockRejectedValueOnce(err);
    const res = await makeApp().inject({
      method: 'POST',
      url: '/refresh-after-verify',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ error: 'Verification window expired' });
  });

  it('returns 500 Internal error on an unexpected DB failure (does NOT leak the upstream error)', async () => {
    mockPoolQuery.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '08006' }));
    const res = await makeApp().inject({
      method: 'POST',
      url: '/refresh-after-verify',
      headers: { authorization: `Bearer ${await makeToken()}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal error' });
  });

  it('returns 401 with no Authorization header', async () => {
    const res = await makeApp().inject({
      method: 'POST',
      url: '/refresh-after-verify',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.statusCode).toBe(401);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('returns 401 with a bearer token signed by a different secret', async () => {
    const otherSecret = createSecretKey(Buffer.from('a-different-secret-of-32-or-more-chars!!!!', 'utf-8'));
    const badToken = await new SignJWT({ sub: VALID_USER, role: 'app_user', aud: ['email-svc'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(otherSecret);
    const res = await makeApp().inject({
      method: 'POST',
      url: '/refresh-after-verify',
      headers: { authorization: `Bearer ${badToken}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.statusCode).toBe(401);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('accepts a token whose email_verified claim is FALSE — that is the case we are refreshing', async () => {
    // Sanity: the verifyJwt path does NOT gate on email_verified, so a stale
    // claim-false token must reach the route handler successfully.
    mockPoolQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ token: 'new.jwt.value', email_verified: true }],
    });
    const res = await makeApp().inject({
      method: 'POST',
      url: '/refresh-after-verify',
      headers: {
        authorization: `Bearer ${await makeToken(VALID_USER, { email_verified: false })}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(res.statusCode).toBe(200);
  });

  it('rate-limit is keyed on JWT sub, so different users do not share a bucket', async () => {
    // Per rateLimit.ts, the route uses userOrIpKey (key = "u:<sub>"). Two
    // different subs hitting the endpoint must not contend.
    const rawMax = rateLimitConfig.routes['/refresh-after-verify']?.max;
    const cap = typeof rawMax === 'number' ? rawMax : 0;
    expect(cap, 'rate limit configured for /refresh-after-verify (number max)').toBeGreaterThan(0);

    mockPoolQuery.mockResolvedValue({
      rowCount: 1,
      rows: [{ token: 'new.jwt.value', email_verified: true }],
    });
    const app = makeApp();
    // Exhaust user A's bucket
    for (let i = 0; i < cap; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/refresh-after-verify',
        headers: { authorization: `Bearer ${await makeToken(VALID_USER)}`, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.statusCode).toBe(200);
    }
    // The very next call by user A is rate-limited (429).
    const overLimit = await app.inject({
      method: 'POST',
      url: '/refresh-after-verify',
      headers: { authorization: `Bearer ${await makeToken(VALID_USER)}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(overLimit.statusCode).toBe(429);
    // User B is unaffected (different bucket).
    const otherUser = await app.inject({
      method: 'POST',
      url: '/refresh-after-verify',
      headers: { authorization: `Bearer ${await makeToken(SECOND_USER)}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(otherUser.statusCode).toBe(200);
  });
});
