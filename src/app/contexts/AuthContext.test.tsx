import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { type ReactNode } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import { deriveKey } from '../../lib/crypto';

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it('starts unauthenticated and resolves isLoading to false', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    expect(result.current.token).toBeNull();
    expect(result.current.userId).toBeNull();
    expect(result.current.cryptoKey).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  // -------------------------------------------------------------------------
  // login()
  // -------------------------------------------------------------------------
  it('login() stores token in state and localStorage', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    const key = await deriveKey('password123', 'test@example.com');
    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key);
    });

    expect(result.current.token).toBe('jwt-token');
    expect(result.current.userId).toBe('user-1');
    expect(result.current.email).toBe('test@example.com');
    expect(localStorage.getItem('bb2_token')).toBe('jwt-token');
    expect(localStorage.getItem('bb2_user_id')).toBe('user-1');
  });

  it('login() stores CryptoKey in state and exports it to sessionStorage', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    const key = await deriveKey('password123', 'test@example.com');
    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key);
    });

    expect(result.current.cryptoKey).not.toBeNull();
    expect(sessionStorage.getItem('bb2_crypto_key')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // logout()
  // -------------------------------------------------------------------------
  it('logout() clears token and cryptoKey from state', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    const key = await deriveKey('password123', 'test@example.com');
    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key);
    });

    act(() => {
      result.current.logout();
    });

    expect(result.current.token).toBeNull();
    expect(result.current.cryptoKey).toBeNull();
  });

  it('logout() removes all auth keys from localStorage and sessionStorage', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    const key = await deriveKey('password123', 'test@example.com');
    await act(async () => {
      await result.current.login('jwt-token', 'user-1', 'test@example.com', key);
    });

    act(() => {
      result.current.logout();
    });

    expect(localStorage.getItem('bb2_token')).toBeNull();
    expect(localStorage.getItem('bb2_user_id')).toBeNull();
    expect(localStorage.getItem('bb2_email')).toBeNull();
    expect(sessionStorage.getItem('bb2_crypto_key')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Session restore on remount
  // -------------------------------------------------------------------------
  it('restores token and CryptoKey from storage on remount', async () => {
    // First mount — log in
    const { result: r1 } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    const key = await deriveKey('password123', 'test@example.com');
    await act(async () => {
      await r1.current.login('saved-token', 'saved-user', 'test@example.com', key);
    });

    // Second mount — simulates a page refresh; storage is still populated
    const { result: r2 } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {}); // flush the restore useEffect

    expect(r2.current.token).toBe('saved-token');
    expect(r2.current.userId).toBe('saved-user');
    expect(r2.current.cryptoKey).not.toBeNull();
    expect(r2.current.isLoading).toBe(false);
  });

  it('does not restore session when sessionStorage key is missing (tab closed scenario)', async () => {
    // Simulate localStorage having auth data but sessionStorage being empty
    localStorage.setItem('bb2_token', 'old-token');
    localStorage.setItem('bb2_user_id', 'old-user');
    localStorage.setItem('bb2_email', 'old@example.com');
    // sessionStorage is empty (cleared in beforeEach)

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    // Should not restore — key is gone
    expect(result.current.token).toBeNull();
    expect(result.current.cryptoKey).toBeNull();
  });
});
