import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { exportKey, importKey } from '../../lib/crypto';

interface AuthState {
  token: string | null;
  userId: string | null;
  email: string | null;
  cryptoKey: CryptoKey | null;
}

interface AuthContextValue extends AuthState {
  isLoading: boolean;
  login: (token: string, userId: string, email: string, cryptoKey: CryptoKey) => Promise<void>;
  updateKey: (cryptoKey: CryptoKey) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY    = 'bb2_token';
const USER_ID_KEY  = 'bb2_user_id';
const EMAIL_KEY    = 'bb2_email';
const CRYPTO_KEY_KEY = 'bb2_crypto_key';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    token: null,
    userId: null,
    email: null,
    cryptoKey: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on mount: token + userId + email from localStorage,
  // CryptoKey bytes from sessionStorage (cleared when the tab closes).
  useEffect(() => {
    const token     = localStorage.getItem(TOKEN_KEY);
    const userId    = localStorage.getItem(USER_ID_KEY);
    const email     = localStorage.getItem(EMAIL_KEY);
    const keyEnc    = sessionStorage.getItem(CRYPTO_KEY_KEY);

    if (token && userId && email && keyEnc) {
      importKey(keyEnc)
        .then((cryptoKey) => setState({ token, userId, email, cryptoKey }))
        .catch(() => {
          // Stale / corrupt key — clear everything and require re-login.
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_ID_KEY);
          localStorage.removeItem(EMAIL_KEY);
          sessionStorage.removeItem(CRYPTO_KEY_KEY);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (
    token: string,
    userId: string,
    email: string,
    cryptoKey: CryptoKey,
  ) => {
    const keyEnc = await exportKey(cryptoKey);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_ID_KEY, userId);
    localStorage.setItem(EMAIL_KEY, email);
    sessionStorage.setItem(CRYPTO_KEY_KEY, keyEnc);
    setState({ token, userId, email, cryptoKey });
  };

  const updateKey = async (cryptoKey: CryptoKey) => {
    const keyEnc = await exportKey(cryptoKey);
    sessionStorage.setItem(CRYPTO_KEY_KEY, keyEnc);
    setState((s) => ({ ...s, cryptoKey }));
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(EMAIL_KEY);
    sessionStorage.removeItem(CRYPTO_KEY_KEY);
    setState({ token: null, userId: null, email: null, cryptoKey: null });
  };

  return (
    <AuthContext.Provider value={{ ...state, isLoading, login, updateKey, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
