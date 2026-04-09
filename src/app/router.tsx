import { Navigate } from 'react-router';
import { useAuth } from './contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * Redirects to /login if the user has no valid session (no JWT or no crypto
 * key). While the auth state is being restored from storage, renders nothing
 * to avoid a flash of the login page.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { token, cryptoKey, isLoading } = useAuth();

  if (isLoading) return null;

  if (!token || !cryptoKey) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
