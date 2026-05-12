import { createContext, useContext, useState, ReactNode } from 'react';
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

  const login = async (
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
  };

  const updateKey = (cryptoKey: CryptoKey) => {
    setState((s) => ({ ...s, cryptoKey }));
  };

  const clearPartialRotation = () => {
    setState((s) => ({ ...s, partialRotation: null }));
  };

  const setEmailVerified = (verified: boolean) => {
    setState((s) => ({ ...s, emailVerified: verified }));
  };

  const applyVerifiedToken = (token: string) => {
    setAuthToken(token);
    setState((s) => ({ ...s, token, emailVerified: true }));
  };

  const logout = () => {
    setAuthToken(null);
    setState({ token: null, userId: null, email: null, cryptoKey: null, partialRotation: null, emailVerified: false });
  };

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
