const BASE = '/api';
let refreshingPromise = null;

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

/** Fetch wrapper: JSON bodies, cookies, one silent refresh + retry on 401. */
export async function api(path, { method = 'GET', body, params } = {}) {
  const url = buildUrl(path, params);
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res = await fetch(url, opts);

  if (res.status === 401 && !path.startsWith('/auth/')) {
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

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('cat:unauthorized'));
    }
    throw new ApiError(res.status, (data && data.message) || res.statusText || 'Request failed', data ? data.errors : undefined);
  }
  return data;
}