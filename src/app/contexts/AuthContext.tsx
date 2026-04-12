import { createContext, useContext, useState, ReactNode } from 'react';
import { setAuthToken } from '../../lib/api';

interface AuthState {
  token: string | null;
  userId: string | null;
  email: string | null;
  cryptoKey: CryptoKey | null;
}

interface AuthContextValue extends AuthState {
  isLoading: boolean;
  login: (token: string, userId: string, email: string, cryptoKey: CryptoKey) => void;
  updateKey: (cryptoKey: CryptoKey) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    userId: null,
    email: null,
    cryptoKey: null,
  });

  const login = (
    token: string,
    userId: string,
    email: string,
    cryptoKey: CryptoKey,
  ) => {
    // All auth state is kept in memory only — no localStorage or sessionStorage.
    // This prevents XSS from exfiltrating the JWT or the AES-256-GCM key bytes
    // after a tab has been closed or in a separate browsing session.
    setAuthToken(token);
    setState({ token, userId, email, cryptoKey });
  };

  const updateKey = (cryptoKey: CryptoKey) => {
    setState((s) => ({ ...s, cryptoKey }));
  };

  const logout = () => {
    setAuthToken(null);
    setState({ token: null, userId: null, email: null, cryptoKey: null });
  };

  return (
    // isLoading is always false: there is no async storage restore to wait for.
    <AuthContext.Provider value={{ ...state, isLoading: false, login, updateKey, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
