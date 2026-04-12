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
    act(() => {
      result.current.login('jwt-token', 'user-1', 'test@example.com', key);
    });

    expect(result.current.token).toBe('jwt-token');
    expect(result.current.userId).toBe('user-1');
    expect(result.current.email).toBe('test@example.com');
  });

  it('login() stores CryptoKey in state', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    const key = await deriveKey('password123', 'test@example.com');
    act(() => {
      result.current.login('jwt-token', 'user-1', 'test@example.com', key);
    });

    expect(result.current.cryptoKey).not.toBeNull();
  });

  it('login() does NOT persist credentials to localStorage or sessionStorage', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    const key = await deriveKey('password123', 'test@example.com');
    act(() => {
      result.current.login('jwt-token', 'user-1', 'test@example.com', key);
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
    act(() => {
      result.current.login('jwt-token', 'user-1', 'test@example.com', key);
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
    act(() => {
      r1.current.login('saved-token', 'saved-user', 'test@example.com', key);
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
});
