import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';

/**
 * Returns the configured church logo (data URI string) or ''.
 *
 * Reads the authenticated user payload (`/auth/me` → `user.logo`) so it's
 * available on every page without an extra request.  When the logo is
 * changed in Settings, an admin can dispatch `window.dispatchEvent(new
 * Event('cat:logo-updated'))` — this hook refreshes `/auth/me` and returns
 * the new value immediately (and updates the auth context).
 */
export function useLogo() {
  const { user, setUser } = useAuth();
  const [fresh, setFresh] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    const refresh = () => {
      api('/auth/me')
        .then((data) => { if (alive && data && data.user) { setUser(data.user); setFresh(data.user.logo || ''); } })
        .catch(() => {});
    };
    window.addEventListener('cat:logo-updated', refresh);
    return () => { alive = false; window.removeEventListener('cat:logo-updated', refresh); };
  }, [user ? user.id : null, setUser]);

  const val = fresh !== null ? fresh : (user && user.logo) || '';
  return val;
}

export default useLogo;
