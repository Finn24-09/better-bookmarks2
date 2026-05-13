import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import { deriveKey } from '../../lib/crypto';

// ---------------------------------------------------------------------------
// rotationStatus mock
// ---------------------------------------------------------------------------
const mockRotationStatus = vi.fn();
vi.mock('../../lib/auth', () => ({
  rotationStatus: (...args: unknown[]) => mockRotationStatus(...args),
}));

// ---------------------------------------------------------------------------
// resendVerificationEmail mock — the context fires it when a brand-new account
// signs up without a verified email. Must mock the same module path used by
// the implementation: ../../lib/email
// ---------------------------------------------------------------------------
const mockResendVerificationEmail = vi.fn();
vi.mock('../../lib/email', () => ({
  resendVerificationEmail: (...args: unknown[]) => mockResendVerificationEmail(...args),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

// Build a well-formed JWT-shaped string. Signature is irrelevant —
// applyVerifiedToken does not verify it (server is the only signer); the
// local sanity check only inspects shape, sub, email_verified, and exp.
function buildJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, '');
  const body = btoa(JSON.stringify(payload)).replace(/=+$/, '');
  return `${header}.${body}.signature`;
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockRotationStatus.mockResolvedValue({ keyVersion: 1, hasStaleRecords: false });
    mockResendVerificationEmail.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('starts unauthenticated with isLoading immediately false', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.token).toBeNull();
    expect(result.current.userId).toBeNull();
    expect(result.current.cryptoKey).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  // -------------------------------------------------------------------------
  // login()
  // -------------------------------------------------------------------------
  it('login() stores token in state', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    const key = await deriveKey('password123', 'test@example.com');
    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false);
    });

    expect(result.current.token).toBe('jwt-token');
    expect(result.current.userId).toBe('user-1');
    expect(result.current.email).toBe('test@example.com');
  });

  it('login() stores CryptoKey in state', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    const key = await deriveKey('password123', 'test@example.com');
    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false);
    });

    expect(result.current.cryptoKey).not.toBeNull();
  });

  it('login() does NOT persist credentials to localStorage or sessionStorage', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    const key = await deriveKey('password123', 'test@example.com');
    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false);
    });

    expect(localStorage.getItem('bb2_token')).toBeNull();
    expect(localStorage.getItem('bb2_user_id')).toBeNull();
    expect(sessionStorage.getItem('bb2_crypto_key')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // logout()
  // -------------------------------------------------------------------------
  it('logout() clears all auth state from memory', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    const key = await deriveKey('password123', 'test@example.com');
    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false);
    });

    act(() => {
      result.current.logout();
    });

    expect(result.current.token).toBeNull();
    expect(result.current.userId).toBeNull();
    expect(result.current.email).toBeNull();
    expect(result.current.cryptoKey).toBeNull();
  });

  // -------------------------------------------------------------------------
  // No session persistence
  // -------------------------------------------------------------------------
  it('does not restore session across page refresh — re-login always required', async () => {
    // First mount — log in
    const { result: r1 } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');
    await act(async () => {
      await r1.current.login('saved-token', 'saved-user', 'test@example.com', key, false);
    });

    // Second mount simulates a page refresh — state starts completely fresh
    const { result: r2 } = renderHook(() => useAuth(), { wrapper });

    expect(r2.current.token).toBeNull();
    expect(r2.current.cryptoKey).toBeNull();
    expect(r2.current.isLoading).toBe(false);
  });

  it('starts fresh even when stale data exists in localStorage', () => {
    // Simulate stale data from a previous version that stored tokens in localStorage
    localStorage.setItem('bb2_token', 'stale-token');
    localStorage.setItem('bb2_user_id', 'stale-user');
    localStorage.setItem('bb2_email', 'stale@example.com');

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.token).toBeNull();
    expect(result.current.cryptoKey).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  // -------------------------------------------------------------------------
  // partialRotation detection
  // -------------------------------------------------------------------------
  it('partialRotation is null initially', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.partialRotation).toBeNull();
  });

  it('login() calls rotationStatus() after setting auth state', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false);
    });

    expect(mockRotationStatus).toHaveBeenCalledOnce();
  });

  it('leaves partialRotation null when rotationStatus returns hasStaleRecords: false', async () => {
    mockRotationStatus.mockResolvedValue({ keyVersion: 2, hasStaleRecords: false });
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false);
    });

    expect(result.current.partialRotation).toBeNull();
  });

  it('sets partialRotation when rotationStatus returns hasStaleRecords: true', async () => {
    mockRotationStatus.mockResolvedValue({ keyVersion: 3, hasStaleRecords: true });
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false);
    });

    expect(result.current.partialRotation).toEqual({ keyVersion: 3 });
  });

  it('does NOT throw when rotationStatus() rejects', async () => {
    mockRotationStatus.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await expect(
      act(async () => { await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false); }),
    ).resolves.not.toThrow();

    expect(result.current.partialRotation).toBeNull();
  });

  it('clearPartialRotation() sets partialRotation back to null', async () => {
    mockRotationStatus.mockResolvedValue({ keyVersion: 2, hasStaleRecords: true });
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false);
    });
    expect(result.current.partialRotation).not.toBeNull();

    act(() => { result.current.clearPartialRotation(); });

    await waitFor(() => expect(result.current.partialRotation).toBeNull());
  });

  it('logout() clears partialRotation', async () => {
    mockRotationStatus.mockResolvedValue({ keyVersion: 1, hasStaleRecords: true });
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false);
    });
    expect(result.current.partialRotation).not.toBeNull();

    act(() => { result.current.logout(); });

    await waitFor(() => expect(result.current.partialRotation).toBeNull());
  });

  // -------------------------------------------------------------------------
  // emailVerified — added in feat/mailing-service
  // -------------------------------------------------------------------------
  it('emailVerified is false initially', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.emailVerified).toBe(false);
  });

  it('login(..., emailVerified=false) stores emailVerified: false', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false);
    });

    expect(result.current.emailVerified).toBe(false);
  });

  it('login(..., emailVerified=true) stores emailVerified: true', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, true);
    });

    expect(result.current.emailVerified).toBe(true);
  });

  it('setEmailVerified(true) updates state to true', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false);
    });
    expect(result.current.emailVerified).toBe(false);

    act(() => { result.current.setEmailVerified(true); });

    await waitFor(() => expect(result.current.emailVerified).toBe(true));
  });

  it('logout() resets emailVerified to false', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, true);
    });
    expect(result.current.emailVerified).toBe(true);

    act(() => { result.current.logout(); });

    await waitFor(() => expect(result.current.emailVerified).toBe(false));
  });

  // -------------------------------------------------------------------------
  // applyVerifiedToken — single primitive used after a successful
  // POST /api/email/refresh-after-verify lands a fresh JWT carrying the
  // email_verified=true claim. Must swap the in-memory token + flip the
  // emailVerified flag atomically; must NOT touch the crypto key (the key
  // is derived from password + email and is unchanged by verification —
  // touching it would force a re-login and defeat the UX win).
  // -------------------------------------------------------------------------
  it('applyVerifiedToken() swaps the in-memory token and sets emailVerified=true', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await act(async () => {
      await result.current.login('old-jwt', 'user-1', 'test@example.com', key, false);
    });
    expect(result.current.token).toBe('old-jwt');
    expect(result.current.emailVerified).toBe(false);

    const newJwt = buildJwt({ sub: 'user-1', email_verified: true, exp: Math.floor(Date.now()/1000)+60 });
    act(() => { result.current.applyVerifiedToken(newJwt); });

    await waitFor(() => {
      expect(result.current.token).toBe(newJwt);
      expect(result.current.emailVerified).toBe(true);
    });
  });

  it('applyVerifiedToken() does NOT mutate the crypto key (verifying email never re-derives the key)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await act(async () => {
      await result.current.login('old-jwt', 'user-1', 'test@example.com', key, false);
    });
    const keyBefore = result.current.cryptoKey;

    const newJwt = buildJwt({ sub: 'user-1', email_verified: true, exp: Math.floor(Date.now()/1000)+60 });
    act(() => { result.current.applyVerifiedToken(newJwt); });

    await waitFor(() => expect(result.current.token).toBe(newJwt));
    // Same reference — the context did not derive or replace the key.
    expect(result.current.cryptoKey).toBe(keyBefore);
  });

  it('applyVerifiedToken() leaves userId and email unchanged', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await act(async () => {
      await result.current.login('old-jwt', 'user-1', 'test@example.com', key, false);
    });

    const newJwt = buildJwt({ sub: 'user-1', email_verified: true, exp: Math.floor(Date.now()/1000)+60 });
    act(() => { result.current.applyVerifiedToken(newJwt); });

    await waitFor(() => expect(result.current.token).toBe(newJwt));
    expect(result.current.userId).toBe('user-1');
    expect(result.current.email).toBe('test@example.com');
  });

  // -------------------------------------------------------------------------
  // resendVerificationEmail trigger — only fires for fresh sign-ups whose
  // email is not yet verified. Existing logged-in users must NOT re-trigger
  // the cooldown-protected resend on every page load.
  // -------------------------------------------------------------------------
  it('login() calls resendVerificationEmail when isNewAccount=true and emailVerified=false', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false, true);
    });

    expect(mockResendVerificationEmail).toHaveBeenCalledOnce();
  });

  it('login() does NOT call resendVerificationEmail when isNewAccount=true but emailVerified=true', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, true, true);
    });

    expect(mockResendVerificationEmail).not.toHaveBeenCalled();
  });

  it('login() does NOT call resendVerificationEmail when isNewAccount=false (regardless of emailVerified)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    // emailVerified=false but this is an existing-user sign-in, not a fresh sign-up
    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false, false);
    });

    expect(mockResendVerificationEmail).not.toHaveBeenCalled();
  });

  it('login() defaults isNewAccount to false — no resend on a 5-arg call', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    // Five-arg call (no isNewAccount) — must behave like an existing-user login
    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false);
    });

    expect(mockResendVerificationEmail).not.toHaveBeenCalled();
  });

  it('does NOT throw when resendVerificationEmail rejects (fire-and-forget)', async () => {
    mockResendVerificationEmail.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    const key = await deriveKey('password123', 'test@example.com');

    await expect(
      act(async () => {
        await result.current.login('jwt-token', 'user-1', 'test@example.com', key, false, true);
      }),
    ).resolves.not.toThrow();

    expect(result.current.token).toBe('jwt-token');
  });
});

describe('AuthContext callback stability', () => {
  it('keeps applyVerifiedToken and setEmailVerified referentially stable across re-renders', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result, rerender } = renderHook(() => useAuth(), { wrapper });

    const firstApply = result.current.applyVerifiedToken;
    const firstSetVerified = result.current.setEmailVerified;
    const firstUpdateKey = result.current.updateKey;
    const firstClearPartial = result.current.clearPartialRotation;
    const firstLogout = result.current.logout;

    // Trigger an unrelated state change to force a re-render.
    act(() => result.current.setEmailVerified(true));
    rerender();

    expect(result.current.applyVerifiedToken).toBe(firstApply);
    expect(result.current.setEmailVerified).toBe(firstSetVerified);
    expect(result.current.updateKey).toBe(firstUpdateKey);
    expect(result.current.clearPartialRotation).toBe(firstClearPartial);
    expect(result.current.logout).toBe(firstLogout);
  });
});

describe('applyVerifiedToken local sanity check', () => {
  // Uses the shared `buildJwt` helper at the top of this file. Signature
  // is irrelevant — applyVerifiedToken does not verify the signature
  // (server is the only signer; same-origin is the trust boundary). The
  // local check is defence-in-depth against a future XHR helper letting a
  // service worker or extension intercept the response and install garbage.

  it('installs a JWT whose payload is well-formed', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    const userId = 'user-abc';
    await act(async () => {
      await result.current.login('initial-token', userId, 'a@b.com', {} as CryptoKey, false);
    });

    const fresh = buildJwt({
      sub: userId,
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    act(() => result.current.applyVerifiedToken(fresh));

    expect(result.current.token).toBe(fresh);
    expect(result.current.emailVerified).toBe(true);
  });

  it.each([
    ['not three segments', 'aaa.bbb'],
    ['payload not base64-decodable', 'aaa.!!!.ccc'],
    ['payload not JSON', `aaa.${btoa('not-json')}.ccc`],
    ['sub mismatch', () => buildJwt({ sub: 'other-user', email_verified: true, exp: Math.floor(Date.now()/1000)+60 })],
    ['email_verified !== true (string)', () => buildJwt({ sub: 'user-abc', email_verified: 'true', exp: Math.floor(Date.now()/1000)+60 })],
    ['email_verified !== true (false)', () => buildJwt({ sub: 'user-abc', email_verified: false, exp: Math.floor(Date.now()/1000)+60 })],
    ['exp in the past', () => buildJwt({ sub: 'user-abc', email_verified: true, exp: Math.floor(Date.now()/1000)-1 })],
    ['exp missing', () => buildJwt({ sub: 'user-abc', email_verified: true })],
  ])('rejects: %s', async (_label, tokenOrFactory) => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.login('initial-token', 'user-abc', 'a@b.com', {} as CryptoKey, false);
    });
    const tokenBefore = result.current.token;
    const verifiedBefore = result.current.emailVerified;

    const bad = typeof tokenOrFactory === 'function' ? tokenOrFactory() : tokenOrFactory;
    act(() => result.current.applyVerifiedToken(bad));

    expect(result.current.token).toBe(tokenBefore);     // unchanged
    expect(result.current.emailVerified).toBe(verifiedBefore); // unchanged
  });
});
