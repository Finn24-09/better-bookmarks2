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
