import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch, ApiError, setAuthToken } from './api';

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAuthToken(null);
  });

  // -------------------------------------------------------------------------
  // Empty-body responses
  // -------------------------------------------------------------------------
  it('returns undefined for 204 No Content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    const result = await apiFetch('/test');
    expect(result).toBeUndefined();
  });

  it('returns undefined for 201 with empty body (PostgREST default insert without return=representation)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    }));
    const result = await apiFetch('/test', { method: 'POST', body: '{}' });
    expect(result).toBeUndefined();
  });

  it('returns undefined for 200 with empty body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    }));
    const result = await apiFetch('/test');
    expect(result).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Normal JSON responses
  // -------------------------------------------------------------------------
  it('parses and returns JSON body on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: '1' }],
    }));
    const result = await apiFetch<{ id: string }[]>('/test');
    expect(result).toEqual([{ id: '1' }]);
  });

  // -------------------------------------------------------------------------
  // Auth header injection (token lives in memory, set via setAuthToken)
  // -------------------------------------------------------------------------
  it('injects Authorization: Bearer when token is set via setAuthToken', async () => {
    setAuthToken('test-jwt');
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', spy);

    await apiFetch('/test');

    const headers = spy.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-jwt');
  });

  it('does not inject Authorization header when no token is set', async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', spy);

    await apiFetch('/test');

    const headers = spy.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------
  it('throws ApiError with generic message for 403 (does not leak server details)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'permission denied for table bookmarks' }),
    }));

    const err = await apiFetch('/test').catch((e) => e) as ApiError;
    expect(err.status).toBe(403);
    expect(err.message).toBe('You do not have permission to perform this action.');
  });

  it('throws ApiError with generic message for 403 on auth RPCs (S-2: 403 is not passed through)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Invalid credentials' }),
    }));

    const err = await apiFetch('/rpc/change_password').catch((e) => e) as ApiError;
    expect(err.status).toBe(403);
    // 403 is no longer relayed for auth RPCs — generic message prevents info leakage.
    expect(err.message).toBe('You do not have permission to perform this action.');
  });

  it('throws ApiError with generic message for 401 on auth RPCs (S-2: 401 is not passed through)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid email or password' }),
    }));

    const err = await apiFetch('/rpc/sign_in').catch((e) => e) as ApiError;
    expect(err.status).toBe(401);
    // 401 is no longer relayed for auth RPCs — only 400 and 409 are intentional user errors.
    expect(err.message).toBe('Authentication required. Please sign in.');
  });

  it('relays "Invalid email or password" body message on 400 from /rpc/sign_in (S-2: 400 IS the user-facing channel)', async () => {
    // Locks the contract: the SQL function must raise with an errcode that maps to
    // HTTP 400 (e.g. check_violation → 23514) so the message reaches the user.
    // If sign_in's errcode is changed to one that maps to 401/403, this test fails.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Invalid email or password' }),
    }));

    const err = await apiFetch('/rpc/sign_in', { method: 'POST' }).catch((e) => e) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('Invalid email or password');
  });

  it('throws ApiError with generic message for 401 on non-auth paths (no schema leakage)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'new row violates row-level security policy for table "bookmarks"' }),
    }));

    const err = await apiFetch('/bookmarks').catch((e) => e) as ApiError;
    expect(err.status).toBe(401);
    expect(err.message).toBe('Authentication required. Please sign in.');
  });

  it('throws ApiError with fallback message when error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new SyntaxError('not json'); },
    }));

    let caught: unknown;
    try { await apiFetch('/test'); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(500);
  });

  it('prepends /api to the path', async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', spy);

    await apiFetch('/bookmarks');

    expect(spy.mock.calls[0][0]).toBe('/api/bookmarks');
  });
});
