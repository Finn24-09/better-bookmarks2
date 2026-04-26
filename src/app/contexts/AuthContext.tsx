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

  const logout = () => {
    setAuthToken(null);
    setState({ token: null, userId: null, email: null, cryptoKey: null, partialRotation: null, emailVerified: false });
  };

  return (
    <AuthContext.Provider value={{ ...state, isLoading: false, login, updateKey, clearPartialRotation, setEmailVerified, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
