import { describe, it, expect, vi } from 'vitest';
import { SignJWT } from 'jose';
import { createSecretKey } from 'node:crypto';

// Mock config before importing jwt
vi.mock('./config.js', () => ({
  config: { JWT_SECRET: 'a-test-secret-that-is-at-least-32-chars-long!' },
}));

const { verifyJwt } = await import('./jwt.js');

const SECRET = 'a-test-secret-that-is-at-least-32-chars-long!';
const secretKey = createSecretKey(Buffer.from(SECRET, 'utf-8'));

async function makeToken(overrides: Record<string, unknown> = {}, expiredAgo = false): Promise<string> {
  const base = {
    sub: '00000000-0000-4000-8000-000000000001',
    role: 'app_user',
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
});
