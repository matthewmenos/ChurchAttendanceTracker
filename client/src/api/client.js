const BASE = '/api';
let refreshingPromise = null;

/**
 * Session endpoints that must never trigger the silent refresh: `/auth/login`
 * and `/auth/logout` are the session boundaries themselves, and refreshing from
 * inside `/auth/refresh` would recurse.
 *
 * Everything else under `/auth/` IS refreshable — most importantly `/auth/me`,
 * the call that rehydrates the session when the installed PWA is reopened (or
 * when the service worker reloads the page after a deploy). Excluding the whole
 * `/auth/` prefix meant a lapsed 15-minute access token always bounced the user
 * back to the sign-in screen, even with a perfectly valid refresh cookie in
 * hand; that is what made the PWA session feel ephemeral.
 */
const SESSION_BOUNDARY_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

/** True when a 401 on this path should be retried through the refresh cookie. */
export function canSilentlyRefresh(path) {
  const clean = String(path || '').split('?')[0].replace(/\/+$/, '') || '/';
  return !SESSION_BOUNDARY_PATHS.includes(clean);
}

/**
 * Drops cached API responses held by the service worker (see the `api-cache`
 * runtime cache in vite.config.js). Called on an explicit sign-out so the next
 * person to open the installed app on a shared device cannot read the previous
 * user's members, rosters or reports.
 *
 * Deliberately NOT called when a session merely expires: an usher who is offline
 * with a stale session would otherwise lose the cached rosters they can still
 * work from.
 */
export async function clearApiCache() {
  try {
    if (typeof caches === 'undefined') return;
    await caches.delete('api-cache');
  } catch (e) {
    // Cache Storage unavailable (private mode, unsupported browser) — the
    // cookies are already cleared, so there is nothing else to do.
  }
}

export class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

function buildUrl(path, params) {
  let url = BASE + path;
  if (params) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        qs.append(key, value);
      }
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

/** Fetch with cookies, retrying once through the silent refresh on a 401. */
async function fetchWithAuth(url, opts, path) {
  let res = await fetch(url, opts);

  // A 401 usually just means the 15-minute access cookie lapsed while the app
  // was closed — worth one transparent refresh-and-retry before giving up.
  if (res.status === 401 && canSilentlyRefresh(path)) {
    try {
      if (!refreshingPromise) {
        refreshingPromise = fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        }).then((r) => {
          refreshingPromise = null;
          if (!r.ok) throw new Error('refresh failed');
        });
      }
      await refreshingPromise;
      res = await fetch(url, opts);
    } catch (e) {
      refreshingPromise = null;
    }
  }
  return res;
}

/** Reads the API error payload, tolerating non-JSON (e.g. file) responses. */
async function readError(res) {
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return {
    message: (data && data.message) || res.statusText || 'Request failed',
    errors: data ? data.errors : undefined,
  };
}

/** Fetch wrapper: JSON bodies, cookies, one silent refresh + retry on 401. */
export async function api(path, { method = 'GET', body, params } = {}) {
  const url = buildUrl(path, params);
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetchWithAuth(url, opts, path);

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  if (!res.ok) {
    // The retry in fetchWithAuth already went through the refresh cookie, so a
    // 401 here means the session is genuinely gone — tell the app to return to
    // sign-in instead of leaving it on a screen that can no longer load data.
    if (res.status === 401 && canSilentlyRefresh(path)) {
      window.dispatchEvent(new Event('cat:unauthorized'));
    }
    throw new ApiError(res.status, (data && data.message) || res.statusText || 'Request failed', data ? data.errors : undefined);
  }
  return data;
}

/** Fetches a binary response (e.g. the Excel export) and returns it as a Blob. */
export async function apiBlob(path, { params } = {}) {
  const res = await fetchWithAuth(buildUrl(path, params), { method: 'GET', credentials: 'include' }, path);
  if (!res.ok) {
    const { message, errors } = await readError(res);
    throw new ApiError(res.status, message, errors);
  }
  return res.blob();
}