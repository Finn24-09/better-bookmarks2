import { describe, it, expect, vi } from 'vitest';
import { SignJWT } from 'jose';
import { createSecretKey } from 'node:crypto';

vi.mock('./config.js', () => ({
  config: {
    JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long!',
    JWT_AUDIENCE: 'metadata-svc',
    JWT_ISSUER: undefined,
    NODE_ENV: 'test',
  },
}));

const { verifyJwt } = await import('./jwt.js');

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long!';
const secretKey = createSecretKey(Buffer.from(SECRET, 'utf-8'));

async function makeToken(overrides: Record<string, unknown> = {}, expiredAgo = false): Promise<string> {
  const base: Record<string, unknown> = {
    sub: '00000000-0000-4000-8000-000000000001',
    role: 'app_user',
    aud: ['email-svc', 'metadata-svc'],
    email_verified: true,
    exp: expiredAgo
      ? Math.floor(Date.now() / 1000) - 3600
      : Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
  // Allow tests to opt out of a claim entirely by passing `undefined` as the
  // override value — otherwise spread above would keep the default.
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete base[k];
  }
  return new SignJWT(base).setProtectedHeader({ alg: 'HS256' }).sign(secretKey);
}

describe('verifyJwt', () => {
  it('accepts a valid array-aud token containing metadata-svc', async () => {
    const token = await makeToken();
    const result = await verifyJwt(`Bearer ${token}`);
    expect(result.sub).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('accepts a single-string aud=metadata-svc token', async () => {
    const token = await makeToken({ aud: 'metadata-svc' });
    const result = await verifyJwt(`Bearer ${token}`);
    expect(result.sub).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('rejects a token whose aud array does NOT include metadata-svc', async () => {
    const token = await makeToken({ aud: ['email-svc'] });
    await expect(verifyJwt(`Bearer ${token}`)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a token with single-string aud=email-svc (the email service-only token)', async () => {
    const token = await makeToken({ aud: 'email-svc' });
    await expect(verifyJwt(`Bearer ${token}`)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a missing Authorization header', async () => {
    await expect(verifyJwt(undefined)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a non-Bearer Authorization header', async () => {
    await expect(verifyJwt('Basic abc')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a tampered token', async () => {
    const token = await makeToken();
    const tampered = token.slice(0, -4) + 'XXXX';
    await expect(verifyJwt(`Bearer ${tampered}`)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects an expired token', async () => {
    const token = await makeToken({}, true);
    await expect(verifyJwt(`Bearer ${token}`)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects role !== app_user', async () => {
    const token = await makeToken({ role: 'anon' });
    await expect(verifyJwt(`Bearer ${token}`)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a non-UUID sub', async () => {
    const token = await makeToken({ sub: 'not-a-uuid' });
    await expect(verifyJwt(`Bearer ${token}`)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a token with no aud claim', async () => {
    const token = await makeToken({ aud: undefined });
    await expect(verifyJwt(`Bearer ${token}`)).rejects.toMatchObject({ statusCode: 401 });
  });

  // ── email_verified claim gating ────────────────────────────────────────────
  // The metadata-fetcher cannot reach the DB (deliberate metadata_net
  // isolation), so the claim is the only place this service can read the
  // verification state. Strict === true. Anything else fails closed.

  it('accepts a token with email_verified=true', async () => {
    const token = await makeToken({ email_verified: true });
    const result = await verifyJwt(`Bearer ${token}`);
    expect(result.sub).toBe('00000000-0000-4000-8000-000000000001');
    expect(result.email_verified).toBe(true);
  });

  it('rejects a token whose email_verified claim is missing — required by jose claim list', async () => {
    // jose enforces requiredClaims BEFORE the route sees the payload, so a
    // missing claim falls into the 401 path, not the 403 path. That keeps the
    // jwt_email_verified canary counter's 'missing' state structurally
    // unreachable; the metric carries only 'true' | 'false'.
    const token = await makeToken({ email_verified: undefined });
    await expect(verifyJwt(`Bearer ${token}`)).rejects.toMatchObject({ statusCode: 401 });
  });

  it.each([
    ['boolean false', false],
    ['number 1', 1],
    ['number 0', 0],
    ['string "true"', 'true'],
    ['string "TRUE"', 'TRUE'],
    ['null', null],
    ['empty object', {}],
    ['empty array', []],
    ['the string boolean-true', 'true'],
  ])('rejects email_verified=%s with EmailNotVerifiedError (403, fail-closed)', async (_label, claimValue) => {
    const token = await makeToken({ email_verified: claimValue });
    await expect(verifyJwt(`Bearer ${token}`)).rejects.toMatchObject({
      statusCode: 403,
      kind: 'email-not-verified',
    });
  });
});
