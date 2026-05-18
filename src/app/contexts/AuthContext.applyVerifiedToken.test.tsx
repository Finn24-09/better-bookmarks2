import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';

// Mock api module so we can assert setAuthToken call timing and count
// from outside the React tree. The existing AuthContext.test.tsx
// deliberately does NOT mock this module (it asserts the real in-memory
// _token state); we use a separate file so the mock does not interfere
// with that suite.
const setAuthTokenMock = vi.fn();
vi.mock('../../lib/api', () => ({
  setAuthToken: (...args: unknown[]) => setAuthTokenMock(...args),
  getToken: () => null,
}));

vi.mock('../../lib/auth', () => ({
  rotationStatus: vi.fn().mockResolvedValue({ keyVersion: 1, hasStaleRecords: false }),
}));
vi.mock('../../lib/email', () => ({
  resendVerificationEmail: vi.fn().mockResolvedValue(undefined),
}));

const { AuthProvider, useAuth } = await import('./AuthContext');
const { deriveKey } = await import('../../lib/crypto');

function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, '');
  const body = btoa(JSON.stringify(payload)).replace(/=+$/, '');
  return `${header}.${body}.signature`;
}

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('applyVerifiedToken setAuthToken invocation', () => {
  beforeEach(() => {
    setAuthTokenMock.mockClear();
  });

  it('calls setAuthToken exactly once with the new token on a sub-match', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'a@b.com');
    await act(async () => {
      await result.current.login('initial-token', 'user-1', 'a@b.com', key, false);
    });
    // login itself invokes setAuthToken once with 'initial-token'.
    setAuthTokenMock.mockClear();

    const fresh = buildJwt({
      sub: 'user-1',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    act(() => result.current.applyVerifiedToken(fresh));

    await waitFor(() => expect(result.current.token).toBe(fresh));
    expect(setAuthTokenMock).toHaveBeenCalledTimes(1);
    expect(setAuthTokenMock).toHaveBeenCalledWith(fresh);
  });

  it('does NOT call setAuthToken when payload.sub mismatches the logged-in user', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'a@b.com');
    await act(async () => {
      await result.current.login('initial-token', 'user-1', 'a@b.com', key, false);
    });
    setAuthTokenMock.mockClear();

    const wrongUser = buildJwt({
      sub: 'someone-else',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    act(() => result.current.applyVerifiedToken(wrongUser));

    expect(setAuthTokenMock).not.toHaveBeenCalled();
    expect(result.current.token).toBe('initial-token');
  });

  it('does NOT call setAuthToken when payload validation fails (expired token)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'a@b.com');
    await act(async () => {
      await result.current.login('initial-token', 'user-1', 'a@b.com', key, false);
    });
    setAuthTokenMock.mockClear();

    const expired = buildJwt({
      sub: 'user-1',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    act(() => result.current.applyVerifiedToken(expired));

    expect(setAuthTokenMock).not.toHaveBeenCalled();
    expect(result.current.token).toBe('initial-token');
  });

  // Lock in the property that an applyVerifiedToken immediately followed
  // by a logout leaves the in-memory _token cleared — i.e., moving the
  // setAuthToken side-effect outside the setState updater does NOT open
  // a window where the post-verify token survives a concurrent logout.
  it('logout immediately after applyVerifiedToken leaves _token null', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'a@b.com');
    await act(async () => {
      await result.current.login('initial-token', 'user-1', 'a@b.com', key, false);
    });

    const fresh = buildJwt({
      sub: 'user-1',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    act(() => {
      result.current.applyVerifiedToken(fresh);
      result.current.logout();
    });

    const calls = setAuthTokenMock.mock.calls;
    expect(calls[calls.length - 1]).toEqual([null]);
    expect(result.current.token).toBeNull();
  });
});
