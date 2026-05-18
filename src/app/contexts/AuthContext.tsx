import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { setAuthToken } from '../../lib/api';
import { rotationStatus } from '../../lib/auth';
import { resendVerificationEmail } from '../../lib/email';

interface AuthState {
  token: string | null;
  userId: string | null;
  email: string | null;
  cryptoKey: CryptoKey | null;
  partialRotation: { keyVersion: number } | null;
  emailVerified: boolean;
}

interface AuthContextValue extends AuthState {
  isLoading: boolean;
  login: (token: string, userId: string, email: string, cryptoKey: CryptoKey, emailVerified: boolean, isNewAccount?: boolean) => Promise<void>;
  updateKey: (cryptoKey: CryptoKey) => void;
  clearPartialRotation: () => void;
  setEmailVerified: (verified: boolean) => void;
  /**
   * Swap the in-memory JWT and flip emailVerified to true atomically.
   * Called after POST /api/email/refresh-after-verify returns a fresh
   * post-verify JWT (see src/lib/email.ts:refreshAfterVerify and
   * docker/db/init/12_post_verify_jwt.sql for the full flow).
   *
   * Deliberately does NOT touch cryptoKey — the key is derived from
   * password + email and verification never changes either, so re-deriving
   * here would force a re-login and defeat the UX win of this whole flow.
   */
  applyVerifiedToken: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    userId: null,
    email: null,
    cryptoKey: null,
    partialRotation: null,
    emailVerified: false,
  });

  const login = useCallback(async (
    token: string,
    userId: string,
    email: string,
    cryptoKey: CryptoKey,
    emailVerified: boolean,
    isNewAccount = false,
  ): Promise<void> => {
    setAuthToken(token);
    setState({ token, userId, email, cryptoKey, partialRotation: null, emailVerified });

    if (isNewAccount && !emailVerified) {
      resendVerificationEmail().catch(() => {});
    }

    try {
      const status = await rotationStatus();
      if (status.hasStaleRecords) {
        setState((s) => ({ ...s, partialRotation: { keyVersion: status.keyVersion } }));
      }
    } catch {
      // Non-fatal — user can re-detect by logging out and back in.
    }
  }, []);

  const updateKey = useCallback((cryptoKey: CryptoKey) => {
    setState((s) => ({ ...s, cryptoKey }));
  }, []);

  const clearPartialRotation = useCallback(() => {
    setState((s) => ({ ...s, partialRotation: null }));
  }, []);

  const setEmailVerified = useCallback((verified: boolean) => {
    setState((s) => ({ ...s, emailVerified: verified }));
  }, []);

  const applyVerifiedToken = useCallback((token: string) => {
    // Defence-in-depth: validate the new JWT's payload locally before
    // installing it. Server is the only signer (same-origin trust
    // boundary), so we deliberately do NOT verify the signature here —
    // that would require shipping the HS256 secret to the browser. We do
    // sanity-check that the payload's `sub` matches the current user, the
    // `email_verified` claim is strict-true, and the token has not expired.
    // Closes Security L-1: a future XHR helper letting a service worker or
    // extension intercept this response cannot install an arbitrary string.
    const parts = token.split('.');
    if (parts.length !== 3) return;
    let payload: { sub?: unknown; email_verified?: unknown; exp?: unknown };
    try {
      // Accept both standard and URL-safe base64 — jose mints URL-safe.
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      payload = JSON.parse(atob(padded));
    } catch {
      return;
    }
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return;
    if (payload.email_verified !== true) return;
    if (typeof payload.sub !== 'string') return;

    // Sub-equality check runs INSIDE the updater so it reads the latest
    // committed userId. The token install (setAuthToken) runs OUTSIDE,
    // wrapped in flushSync so the updater has definitely committed by
    // the time we inspect `accepted`. React 19 no longer guarantees the
    // synchronous eager-state pass that earlier versions did, so a plain
    // setState would queue the updater for reconciliation and leave
    // `accepted` false at the post-setState check.
    //
    // Keeping the side-effect outside the reducer also closes a race
    // present in the previous "setAuthToken inside the updater" shape:
    // when a logout() lands in the same tick, React would re-invoke
    // the updater during reconciliation AFTER logout's synchronous
    // setAuthToken(null) had already run, re-installing the post-verify
    // JWT into _token. Locking that property is the job of the race
    // regression test in AuthContext.applyVerifiedToken.test.tsx.
    let accepted = false;
    flushSync(() => {
      setState((s) => {
        if (s.userId === null || payload.sub !== s.userId) return s;
        accepted = true;
        return { ...s, token, emailVerified: true };
      });
    });
    if (accepted) setAuthToken(token);
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setState({ token: null, userId: null, email: null, cryptoKey: null, partialRotation: null, emailVerified: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, isLoading: false, login, updateKey, clearPartialRotation, setEmailVerified, applyVerifiedToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
