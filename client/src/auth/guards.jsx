import { useContext } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthContext } from './AuthContext.jsx';
import { Spinner } from '../components/ui/feedback.jsx';

export function RequireAuth() {
  const { user, initializing } = useContext(AuthContext);
  const location = useLocation();
  if (initializing) return <div className="page-center"><Spinner size="lg" /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <Outlet />;
}

export function RequireRole({ allow }) {
  const { user } = useContext(AuthContext);
  if (!user) return <Navigate to="/login" replace />;
  if (!allow.includes(user.role)) return <Navigate to="/denied" replace />;
  return <Outlet />;
}

export function RoleRedirect() {
  const { user, initializing } = useContext(AuthContext);
  if (initializing) return <div className="page-center"><Spinner size="lg" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/usher'} replace />;
}