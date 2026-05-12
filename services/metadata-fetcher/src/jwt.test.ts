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
  const base = {
    sub: '00000000-0000-4000-8000-000000000001',
    role: 'app_user',
    aud: ['email-svc', 'metadata-svc'],
    exp: expiredAgo
      ? Math.floor(Date.now() / 1000) - 3600
      : Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
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
});
