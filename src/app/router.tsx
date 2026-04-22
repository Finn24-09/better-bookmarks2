import { Fragment } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from './contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * Redirects to /login if the user has no valid session (no JWT or no crypto
 * key). While the auth state is being restored from storage, renders nothing
 * to avoid a flash of the login page.
 *
 * key={userId} on the Fragment forces a full unmount+remount of the App
 * component tree whenever the logged-in user changes. Without this, React
 * keeps the same component instances alive across account switches, causing
 * stale bookmark state, wrong crypto keys, and the IntersectionObserver
 * infinite-reload loop observed after creating a second account.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { token, cryptoKey, userId, isLoading } = useAuth();

  if (isLoading) return null;

  if (!token || !cryptoKey) {
    return <Navigate to="/login" replace />;
  }

  return <Fragment key={userId}>{children}</Fragment>;
}
