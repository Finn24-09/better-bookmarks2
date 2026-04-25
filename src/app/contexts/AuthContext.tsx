import { createContext, useContext, useState, ReactNode } from 'react';
import { setAuthToken } from '../../lib/api';
import { rotationStatus } from '../../lib/auth';

interface AuthState {
  token: string | null;
  userId: string | null;
  email: string | null;
  cryptoKey: CryptoKey | null;
  partialRotation: { keyVersion: number } | null;
}

interface AuthContextValue extends AuthState {
  isLoading: boolean;
  login: (token: string, userId: string, email: string, cryptoKey: CryptoKey) => Promise<void>;
  updateKey: (cryptoKey: CryptoKey) => void;
  clearPartialRotation: () => void;
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
  });

  const login = async (
    token: string,
    userId: string,
    email: string,
    cryptoKey: CryptoKey,
  ): Promise<void> => {
    // All auth state is kept in memory only — no localStorage or sessionStorage.
    // This prevents XSS from exfiltrating the JWT or the AES-256-GCM key bytes
    // after a tab has been closed or in a separate browsing session.
    setAuthToken(token);
    setState({ token, userId, email, cryptoKey, partialRotation: null });

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

  const logout = () => {
    setAuthToken(null);
    setState({ token: null, userId: null, email: null, cryptoKey: null, partialRotation: null });
  };

  return (
    // isLoading is always false: there is no async storage restore to wait for.
    <AuthContext.Provider value={{ ...state, isLoading: false, login, updateKey, clearPartialRotation, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
