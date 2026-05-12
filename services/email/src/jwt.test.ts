import { describe, it, expect, vi } from 'vitest';
import { SignJWT } from 'jose';
import { createSecretKey } from 'node:crypto';

// Mock config before importing jwt.
vi.mock('./config.js', () => ({
  config: {
    JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long!',
    JWT_AUDIENCE: 'email-svc',
    JWT_ISSUER: undefined,
    NODE_ENV: 'production',
  },
}));

const { verifyJwt } = await import('./jwt.js');

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long!';
const secretKey = createSecretKey(Buffer.from(SECRET, 'utf-8'));

async function makeToken(overrides: Record<string, unknown> = {}, expiredAgo = false): Promise<string> {
  const base = {
    sub: '00000000-0000-4000-8000-000000000001',
    role: 'app_user',
    aud: 'email-svc',
    exp: expiredAgo
      ? Math.floor(Date.now() / 1000) - 3600
      : Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
  return new SignJWT(base).setProtectedHeader({ alg: 'HS256' }).sign(secretKey);
}

describe('verifyJwt', () => {
  it('accepts a valid token and returns the sub', async () => {
    const token = await makeToken();
    const result = await verifyJwt(`Bearer ${token}`);
    expect(result.sub).toBe('00000000-0000-4000-8000-000000000001');
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

  it('rejects a token signed with alg:none (jose rejects at parse time)', async () => {
    // Craft a fake "none" token — jose will reject this outright
    const parts = ['eyJhbGciOiJub25lIn0', 'eyJzdWIiOiJ0ZXN0Iiwicm9sZSI6ImFwcF91c2VyIn0', ''];
    const fakeNone = parts.join('.');
    await expect(verifyJwt(`Bearer ${fakeNone}`)).rejects.toMatchObject({ statusCode: 401 });
  });

  // ── H-4: audience pinning ─────────────────────────────────────────────────
  // Tokens minted by PostgREST (or any other service sharing the JWT secret)
  // for a different audience MUST be rejected. Without this, a JWT meant for
  // PostgREST is silently accepted by the email service.
  it('H-4: rejects a token with no aud claim (production)', async () => {
    const token = await makeToken({ aud: undefined });
    await expect(verifyJwt(`Bearer ${token}`)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('H-4: rejects a token with wrong aud (e.g. PostgREST)', async () => {
    const token = await makeToken({ aud: 'postgrest' });
    await expect(verifyJwt(`Bearer ${token}`)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('H-4: accepts a token with correct aud=email-svc', async () => {
    const token = await makeToken({ aud: 'email-svc' });
    const result = await verifyJwt(`Bearer ${token}`);
    expect(result.sub).toBe('00000000-0000-4000-8000-000000000001');
  });

  // Multi-audience regression: once api._sign_jwt mints
  // aud=["email-svc","metadata-svc"], jose 6 must continue to accept the
  // array claim against this service's audience: 'email-svc' configuration.
  // jose treats a string requested audience as set-membership against an
  // array claim, so this verifier accepts as long as the array contains the
  // expected value. If this test ever fails, the multi-aud deploy will break
  // every freshly-minted token against the email service.
  it('H-4: accepts a token whose aud array claim contains email-svc', async () => {
    const token = await makeToken({ aud: ['email-svc', 'metadata-svc'] });
    const result = await verifyJwt(`Bearer ${token}`);
    expect(result.sub).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('H-4: rejects a token whose aud array does NOT contain email-svc', async () => {
    const token = await makeToken({ aud: ['metadata-svc'] });
    await expect(verifyJwt(`Bearer ${token}`)).rejects.toMatchObject({ statusCode: 401 });
  });
});
