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

/** Roles that get the admin console (district-wide and single-branch admins). */
export const ADMIN_ROLES = ['district_admin', 'branch_admin'];

/** True when the role manages a branch or the whole church. */
export function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

/**
 * Landing route for a role — the single source of truth used by the sign-in
 * redirect, `/` and the access-denied page, so a new role cannot be forgotten
 * in one of them.
 */
export function homePathFor(role) {
  return isAdminRole(role) ? '/admin' : '/usher';
}

export function RoleRedirect() {
  const { user, initializing } = useContext(AuthContext);
  if (initializing) return <div className="page-center"><Spinner size="lg" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homePathFor(user.role)} replace />;
}
