import { describe, it, expect, vi, afterEach } from 'vitest';
import { signIn, signUp, rotationStatus } from './auth';
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

  it('signIn 401 uses generic message — raw PostgREST error no longer relayed (S-2)', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { message: 'Invalid email or password' }));

    let caught: unknown;
    try {
      await signIn('user@example.com', 'wrongpass');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    // After S-2, 401 is treated as a generic auth failure — only 400/409 pass through.
    expect((caught as ApiError).message).toBe('Authentication required. Please sign in.');
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

  // Regression pin (S-3 fallout): the dead `deleteAccount` export and its
  // /rpc/delete_account entry in api.ts AUTH_RPC_PATHS were both pruned in the
  // review-driven cleanup. AUTH_RPC_PATHS is *only* an error-message-relay
  // list — it does not gate routing — but a future careless edit (typo, or
  // re-purposing it as an allow-list) could silently break the live sign-up
  // route. This test pins the canonical URL + method + body so that breakage
  // surfaces as a unit-test failure, not a runtime "The requested resource
  // was not found." toast.
  it('signUp POSTs the body to /api/rpc/sign_up — full URL pin', async () => {
    const fetchSpy = mockFetch(200, { token: 'tok', user_id: 'u1', email_verified: false });
    vi.stubGlobal('fetch', fetchSpy);

    await signUp('new@example.com', 'StrongPass12!');

    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/rpc/sign_up');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({
      email: 'new@example.com',
      password: 'StrongPass12!',
    });
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

  // -------------------------------------------------------------------------
  // rotationStatus
  // -------------------------------------------------------------------------
  it('rotationStatus sends POST to /rpc/rotation_status', async () => {
    const spy = mockFetch(200, { key_version: 1, has_stale_records: false });
    vi.stubGlobal('fetch', spy);
    setAuthToken('test-token');

    await rotationStatus();

    const [url, opts] = spy.mock.calls[0];
    expect(url).toContain('/rpc/rotation_status');
    expect(opts.method).toBe('POST');
  });

  it('rotationStatus returns camelCase-mapped shape', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { key_version: 3, has_stale_records: true }));
    setAuthToken('test-token');

    const result = await rotationStatus();
    expect(result.keyVersion).toBe(3);
    expect(result.hasStaleRecords).toBe(true);
  });

  it('rotationStatus throws when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    setAuthToken('test-token');

    await expect(rotationStatus()).rejects.toBeInstanceOf(ApiError);
  });
});
