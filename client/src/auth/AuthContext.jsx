import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearApiCache } from '../api/client.js';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [locals, setLocals] = useState([]);
  const [currentLocalId, setCurrentLocalId] = useState(null);
  const [initializing, setInitializing] = useState(true);

  // Load locals for district admin
  const loadLocals = useCallback(async () => {
    try {
      const data = await api('/locals');
      setLocals(data.items || []);
      return data.items || [];
    } catch (e) {
      return [];
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api('/auth/me')
      .then((data) => {
        if (!alive) return;
        setUser(data.user);
        // Set initial local from user
        if (data.user?.local_id) {
          setCurrentLocalId(data.user.local_id);
        }
        // Load locals for district admin
        if (data.user?.role === 'district_admin') {
          loadLocals();
        }
      })
      .catch(() => {
        if (alive) setUser(null);
      })
      .finally(() => {
        if (alive) setInitializing(false);
      });

    const onExpired = () => setUser(null);
    window.addEventListener('cat:unauthorized', onExpired);
    return () => {
      alive = false;
      window.removeEventListener('cat:unauthorized', onExpired);
    };
  }, [loadLocals]);

  const login = useCallback(async (email, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    setUser(data.user);
    if (data.user?.local_id) {
      setCurrentLocalId(data.user.local_id);
    }
    if (data.user?.role === 'district_admin') {
      loadLocals();
    }
    return data.user;
  }, [loadLocals]);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setLocals([]);
      setCurrentLocalId(null);
      // Sessions now survive app restarts, so signing out must also drop the API
      // data the service worker cached on this device — otherwise the next user
      // of a shared phone could reopen the app and read it offline.
      await clearApiCache();
    }
  }, []);

  const switchLocal = useCallback((localId) => {
    setCurrentLocalId(localId);
  }, []);

  const value = useMemo(
    () => ({ user, setUser, locals, currentLocalId, switchLocal, initializing, login, logout, loadLocals }),
    [user, locals, currentLocalId, switchLocal, initializing, login, logout, loadLocals]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}