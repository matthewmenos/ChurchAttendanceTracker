import test from 'node:test';
import assert from 'node:assert/strict';

import { api, ApiError, canSilentlyRefresh, clearApiCache } from '../src/api/client.js';

/**
 * Regression tests for the silent-refresh wrapper.
 *
 * The bug these lock down: the wrapper used to skip the refresh for every path
 * under `/auth/`, including `/auth/me` — the call that rehydrates the session
 * when the installed PWA is reopened. With a 15-minute access token, opening the
 * app the next morning always landed on the sign-in screen even though a valid
 * refresh cookie was still on the device.
 *
 * Runs on Node's built-in test runner (no extra dependencies):
 *   npm test
 */

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Installs a scripted fetch stub and a window stub; returns a call log. */
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' });
    return handler(url, opts, calls);
  };
  return calls;
}

function stubWindow() {
  const events = [];
  const target = new EventTarget();
  target.addEventListener('cat:unauthorized', () => events.push('cat:unauthorized'));
  globalThis.window = target;
  return events;
}

test.afterEach(() => {
  delete globalThis.fetch;
  delete globalThis.window;
});

test('canSilentlyRefresh allows session calls but never the session boundaries', () => {
  // The bug: these two must be refreshable so a reopened PWA stays signed in.
  assert.equal(canSilentlyRefresh('/auth/me'), true);
  assert.equal(canSilentlyRefresh('/auth/change-password'), true);
  assert.equal(canSilentlyRefresh('/members'), true);
  assert.equal(canSilentlyRefresh('/reports/export'), true);

  // Refreshing these would either recurse or defeat the point of signing out.
  assert.equal(canSilentlyRefresh('/auth/login'), false);
  assert.equal(canSilentlyRefresh('/auth/refresh'), false);
  assert.equal(canSilentlyRefresh('/auth/logout'), false);

  // Defensive: trailing slashes and query strings must not slip past.
  assert.equal(canSilentlyRefresh('/auth/login/'), false);
  assert.equal(canSilentlyRefresh('/auth/logout?next=/admin'), false);
  assert.equal(canSilentlyRefresh('/auth/me?x=1'), true);
});

test('/auth/me refreshes a lapsed access token and returns the user', async () => {
  const events = stubWindow();
  let meCalls = 0;
  const calls = stubFetch((url) => {
    if (url === '/api/auth/refresh') return jsonResponse({ user: { id: 1 } });
    meCalls += 1;
    // First attempt: the 15-minute access cookie has lapsed.
    if (meCalls === 1) return jsonResponse({ message: 'Your session has expired.' }, 401);
    return jsonResponse({ user: { id: 1, name: 'Ada', role: 'usher' } });
  });

  const data = await api('/auth/me');

  assert.equal(data.user.name, 'Ada');
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    ['GET /api/auth/me', 'POST /api/auth/refresh', 'GET /api/auth/me']
  );
  // The session was recovered, so the app must NOT be told it was signed out.
  assert.deepEqual(events, []);
});

test('concurrent 401s share a single refresh call', async () => {
  stubWindow();
  let refreshed = 0;
  let meCalls = 0;
  const calls = stubFetch((url) => {
    if (url === '/api/auth/refresh') {
      refreshed += 1;
      return jsonResponse({});
    }
    meCalls += 1;
    if (meCalls <= 2) return jsonResponse({ message: 'expired' }, 401);
    return jsonResponse({ user: { id: 1 } });
  });

  await Promise.all([api('/auth/me'), api('/auth/me')]);

  assert.equal(refreshed, 1, 'the refresh must be de-duplicated across parallel requests');
  assert.equal(calls.filter((c) => c.url === '/api/auth/refresh').length, 1);
});

test('a dead refresh cookie surfaces the 401 and notifies the app', async () => {
  const events = stubWindow();
  const calls = stubFetch((url) => {
    if (url === '/api/auth/refresh') return jsonResponse({ message: 'Session expired.' }, 401);
    return jsonResponse({ message: 'Your session has expired.' }, 401);
  });

  await assert.rejects(() => api('/auth/me'), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 401);
    return true;
  });

  assert.deepEqual(events, ['cat:unauthorized']);
  // No retry loop: one original call plus one refresh attempt.
  assert.equal(calls.length, 2);
});

test('login failures are never retried through the refresh cookie', async () => {
  const events = stubWindow();
  const calls = stubFetch(() => jsonResponse({ message: 'Incorrect email or password.' }, 401));

  await assert.rejects(() => api('/auth/login', { method: 'POST', body: {} }), (err) => {
    assert.equal(err.status, 401);
    assert.equal(err.message, 'Incorrect email or password.');
    return true;
  });

  assert.deepEqual(calls.map((c) => c.url), ['/api/auth/login']);
  assert.deepEqual(events, []);
});

test('clearApiCache drops only the cached API data', async () => {
  const deleted = [];
  globalThis.caches = {
    delete: async (name) => {
      deleted.push(name);
      return true;
    },
  };

  await clearApiCache();
  assert.deepEqual(deleted, ['api-cache']);

  // Unsupported (or private-mode) browsers must not throw on sign-out.
  delete globalThis.caches;
  await clearApiCache();
});
