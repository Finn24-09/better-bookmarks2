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

  it('throws ApiError with PostgREST message for 401 (sign_in error is user-friendly)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid email or password' }),
    }));

    await expect(apiFetch('/test')).rejects.toMatchObject({
      status: 401,
      message: 'Invalid email or password',
    });
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
