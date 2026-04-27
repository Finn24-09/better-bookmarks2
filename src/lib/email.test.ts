import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock api module so getToken is controllable
vi.mock('./api', () => ({
  getToken: vi.fn(() => 'mock-jwt-token'),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
});

const {
  requestPasswordReset,
  resendVerificationEmail,
  requestAccountDeletion,
  confirmAccountDeletion,
  notifyPasswordChanged,
} = await import('./email');

describe('requestPasswordReset', () => {
  it('POSTs to /api/email/request-reset with email in body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await requestPasswordReset('user@example.com');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/email/request-reset',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com' }),
      }),
    );
  });
});

describe('resendVerificationEmail', () => {
  it('POSTs to /api/email/resend-verification with Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await resendVerificationEmail();
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer mock-jwt-token');
  });

  // Without this, the 429/500 paths in the route silently look like success
  // to the banner — fetch resolves on non-2xx, so only network rejection
  // would have surfaced as an error and the user-facing toast would never fire.
  it('throws when the server responds with 429', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429 }));
    await expect(resendVerificationEmail()).rejects.toThrow();
  });

  it('throws when the server responds with 500', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await expect(resendVerificationEmail()).rejects.toThrow();
  });
});

describe('requestAccountDeletion', () => {
  it('throws when response is not ok', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await expect(requestAccountDeletion()).rejects.toThrow();
  });

  it('resolves when response is ok', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(requestAccountDeletion()).resolves.toBeUndefined();
  });
});

describe('confirmAccountDeletion', () => {
  it('returns ok:true on 200', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const result = await confirmAccountDeletion('token123', 'password');
    expect(result.ok).toBe(true);
  });

  it('returns ok:false with error message on failure', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Invalid password' }), { status: 400 }),
    );
    const result = await confirmAccountDeletion('bad-token', 'wrong');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid password');
  });

  it('sends token and password in POST body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await confirmAccountDeletion('mytoken', 'mypassword');
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({ token: 'mytoken', password: 'mypassword' });
  });
});

describe('notifyPasswordChanged', () => {
  it('swallows errors silently', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    await expect(notifyPasswordChanged()).resolves.toBeUndefined();
  });

  it('resolves even on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await expect(notifyPasswordChanged()).resolves.toBeUndefined();
  });
});
