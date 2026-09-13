import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [branches, setBranches] = useState([]);
  const [currentBranchId, setCurrentBranchId] = useState(null);
  const [initializing, setInitializing] = useState(true);

  // Load branches for district admin
  const loadBranches = useCallback(async () => {
    try {
      const data = await api('/branches');
      setBranches(data.items || []);
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
        // Set initial branch from user
        if (data.user?.branch_id) {
          setCurrentBranchId(data.user.branch_id);
        }
        // Load branches for district admin
        if (data.user?.role === 'district_admin') {
          loadBranches();
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
  }, [loadBranches]);

  const login = useCallback(async (email, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    setUser(data.user);
    if (data.user?.branch_id) {
      setCurrentBranchId(data.user.branch_id);
    }
    if (data.user?.role === 'district_admin') {
      loadBranches();
    }
    return data.user;
  }, [loadBranches]);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setBranches([]);
      setCurrentBranchId(null);
    }
  }, []);

  const switchBranch = useCallback((branchId) => {
    setCurrentBranchId(branchId);
  }, []);

  const value = useMemo(
    () => ({ user, setUser, branches, currentBranchId, switchBranch, initializing, login, logout, loadBranches }),
    [user, branches, currentBranchId, switchBranch, initializing, login, logout, loadBranches]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}