import { describe, it, expect, vi, afterEach } from 'vitest';
import { signIn, signUp } from './auth';
import { ApiError, setAuthToken } from './api';

// Minimal fetch response factory.
function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('auth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAuthToken(null);
  });

  // -------------------------------------------------------------------------
  // signIn
  // -------------------------------------------------------------------------
  it('signIn returns token and user_id on success', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { token: 'jwt-abc', user_id: 'user-123' }));

    const result = await signIn('user@example.com', 'password123');
    expect(result.token).toBe('jwt-abc');
    expect(result.user_id).toBe('user-123');
  });

  it('signIn with wrong password throws ApiError with status 401', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { message: 'Invalid email or password' }));

    await expect(signIn('user@example.com', 'wrongpass')).rejects.toThrow(ApiError);
    await expect(signIn('user@example.com', 'wrongpass')).rejects.toMatchObject({ status: 401 });
  });

  it('signIn error message is taken from PostgREST response body', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { message: 'Invalid email or password' }));

    let caught: unknown;
    try {
      await signIn('user@example.com', 'wrongpass');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toBe('Invalid email or password');
  });

  it('signIn sends request to /api/rpc/sign_in', async () => {
    const fetchSpy = mockFetch(200, { token: 'tok', user_id: 'u1' });
    vi.stubGlobal('fetch', fetchSpy);

    await signIn('user@example.com', 'password123');

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('/rpc/sign_in');
  });

  // -------------------------------------------------------------------------
  // signUp
  // -------------------------------------------------------------------------
  it('signUp returns token and user_id on success', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { token: 'jwt-new', user_id: 'user-new' }));

    const result = await signUp('new@example.com', 'password123');
    expect(result.token).toBe('jwt-new');
    expect(result.user_id).toBe('user-new');
  });

  it('signUp with duplicate email throws ApiError with status 409', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { message: 'Email already registered' }));

    await expect(signUp('dup@example.com', 'password123')).rejects.toThrow(ApiError);
    await expect(signUp('dup@example.com', 'password123')).rejects.toMatchObject({ status: 409 });
  });

  // -------------------------------------------------------------------------
  // changePassword
  // -------------------------------------------------------------------------
  it('changePassword succeeds without throwing on 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    setAuthToken('test-token');

    await expect(
      (await import('./auth')).changePassword('oldpass', 'newpass123'),
    ).resolves.toBeUndefined();
  });

  it('changePassword with wrong current password throws ApiError with status 401', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { message: 'Current password is incorrect' }));
    setAuthToken('test-token');

    await expect(
      (await import('./auth')).changePassword('wrongcurrent', 'newpass123'),
    ).rejects.toMatchObject({ status: 401 });
  });
});
