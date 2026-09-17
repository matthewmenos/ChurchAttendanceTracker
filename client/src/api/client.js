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

/** Fetch with cookies, retrying once through the silent refresh on a 401. */
async function fetchWithAuth(url, opts, path) {
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
    if (res.status === 401 && !path.startsWith('/auth/')) {
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