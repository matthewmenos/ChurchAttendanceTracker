import { createContext, useCallback, useContext } from 'react';
import { clearApiCache } from '../api/client.js';

/**
 * Provides a `triggerRefresh` callback that every page in the PWA can invoke
 * to pull the latest data from the server.
 *
 * The refresh works in two steps:
 *   1. clearApiCache() deletes the service-worker "api-cache" so the next
 *      API GETs bypass the stale NetworkFirst cache and go to the network.
 *   2. window.location.reload() re-mounts the React tree, which re-runs every
 *      `useFetch` call inside the new page with fresh network responses.
 *
 * A full reload is used (instead of trying to poke each page's `reload()`
 * callback) because ushers navigate between many screens and a page-level
 * reload guarantees every view shows consistent, up-to-date data — the
 * strongest possible guarantee for a PWA whose data is cached offline.
 */
const PullToRefreshContext = createContext(null);

export function PullToRefreshProvider({ children }) {
  const triggerRefresh = useCallback(async () => {
    try {
      await clearApiCache();
    } catch {
      /* cache may be unavailable (private mode) — reload still works */
    }
    window.location.reload();
  }, []);

  const value = { triggerRefresh };
  return (
    <PullToRefreshContext.Provider value={value}>
      {children}
    </PullToRefreshContext.Provider>
  );
}

export function usePullToRefresh() {
  return useContext(PullToRefreshContext);
}
