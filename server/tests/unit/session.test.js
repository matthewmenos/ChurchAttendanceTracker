'use strict';

const request = require('supertest');
const bcrypt = require('bcryptjs');

// Exercised without Postgres: the pool is replaced by a fake that answers the
// queries the auth routes issue.
jest.mock('../../src/config/db', () => ({ query: jest.fn() }));

const db = require('../../src/config/db');
const env = require('../../src/config/env');
const { createApp } = require('../../src/app');
const { signRefreshToken } = require('../../src/utils/tokens');

const app = createApp();
const PASSWORD = 'Passw0rd!';
const DAY_MS = 24 * 60 * 60 * 1000;

let passwordHash;

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 4);
});

const USER = () => ({
  id: 7,
  name: 'Grace Usher',
  email: 'usher@test.app',
  username: null,
  role: 'usher',
  status: 'active',
  must_change_password: false,
  last_login_at: null,
  local_id: 1,
  password_hash: passwordHash,
});

const PUBLIC_USER = () => ({
  ...USER(),
  local_name: 'Central',
  local_allows_member_add: false,
  church_name: 'Grace Chapel',
  logo: '',
});

/**
 * The queries the login/refresh/me routes issue, most distinctive first. Any
 * query that is not listed is recorded so an unmatched one fails loudly rather
 * than silently returning an empty result.
 */
const seen = [];

function script(responses) {
  db.query.mockImplementation(async (sql, params) => {
    const row = responses.find((r) => sql.includes(r.match));
    if (!row) {
      seen.push(sql);
      return { rows: [] };
    }
    if (row.capture) row.capture(params);
    return { rows: row.rows || [] };
  });
}

/** Raw Set-Cookie header for one cookie name ('' when absent). */
function cookieHeader(res, name) {
  const all = res.headers['set-cookie'] || [];
  return all.find((c) => c.startsWith(`${name}=`)) || '';
}

function cookieValue(res, name) {
  const header = cookieHeader(res, name);
  return header ? header.split(';')[0].slice(name.length + 1) : null;
}

beforeEach(() => {
  seen.length = 0;
});
describe('Session lifetime (a PWA session must not be ephemeral)', () => {
  test('the refresh window stays long enough to survive a month between services', () => {
    // Guards the anti-ephemeral floor: the refresh cookie is the only thing
    // keeping an installed PWA signed in, so it must outlast the gap between
    // services (weekly, plus holidays and off-weeks).
    expect(env.refreshTokenTtlDays).toBeGreaterThanOrEqual(30);
    // The access token is deliberately short-lived; the refresh cookie, not
    // this, is what carries the session.
    expect(env.accessTtlMinutes).toBeGreaterThan(0);
  });

  test('login issues a long-lived HttpOnly refresh cookie and a short access cookie', async () => {
    const inserted = [];
    script([
      { match: 'SELECT * FROM users WHERE lower(email)', rows: [USER()] },
      { match: 'UPDATE users SET last_login_at', rows: [] },
      { match: 'INSERT INTO refresh_tokens', rows: [], capture: (p) => inserted.push(p) },
      { match: 'SELECT u.id, u.name, u.email', rows: [PUBLIC_USER()] },
    ]);

    const res = await request(app).post('/api/auth/login').send({ email: 'usher@test.app', password: PASSWORD });
    expect(res.status).toBe(200);

    const refresh = cookieHeader(res, 'cat_refresh_token');
    const access = cookieHeader(res, 'cat_access_token');

    // Attributes that make the cookie both persistent and unreadable to scripts.
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/Path=\//);
    expect(refresh).toMatch(/SameSite=Lax/i);
    expect(/;\s*Secure/i.test(refresh)).toBe(env.cookieSecure);

    const maxAge = Number(refresh.match(/Max-Age=(\d+)/)[1]);
    expect(maxAge).toBe(env.refreshTokenTtlDays * 24 * 60 * 60);
    expect(maxAge).toBeGreaterThanOrEqual(30 * 24 * 60 * 60);
    // An absolute Expires date too, so the cookie survives a browser restart.
    expect(refresh).toMatch(/Expires=/);

    // The access cookie is the short one — expected, and the reason the silent
    // refresh wrapper exists at all.
    const accessMaxAge = Number(access.match(/Max-Age=(\d+)/)[1]);
    expect(accessMaxAge).toBe(env.accessTtlMinutes * 60);
    expect(accessMaxAge).toBeLessThan(maxAge);

    // The stored row must expire in step with the cookie the user holds.
    expect(inserted).toHaveLength(1);
    const [, tokenHash, expiresAt] = inserted[0];
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const drift = Math.abs(new Date(expiresAt).getTime() - (Date.now() + env.refreshTokenTtlDays * DAY_MS));
    expect(drift).toBeLessThan(60 * 1000);
    expect(seen).toEqual([]);
  });

  test('a reopened PWA recovers the session from the refresh cookie alone', async () => {
    // This is the flow client.js runs on every app boot: the short-lived access
    // cookie is long gone, so /auth/me answers 401 and the wrapper refreshes.
    // The token is real, so `sub` must survive the round trip or the route
    // cannot find the account.
    const { token: storedToken } = signRefreshToken(USER());

    script([
      { match: 'SELECT * FROM refresh_tokens', rows: [{ id: 3, user_id: 7, token_hash: 'x', revoked_at: null, expires_at: new Date(Date.now() + 10 * DAY_MS) }] },
      { match: 'SELECT * FROM users WHERE id', rows: [USER()] },
      { match: 'UPDATE refresh_tokens SET revoked_at', rows: [] },
      { match: 'INSERT INTO refresh_tokens', rows: [] },
      { match: 'SELECT u.id, u.name, u.email', rows: [PUBLIC_USER()] },
      // The middleware's own lookup, run on the retry in step 3.
      { match: 'must_change_password, last_login_at, local_id', rows: [USER()] },
    ]);

    // Step 1 — boot with only the refresh cookie: unauthenticated, as expected.
    const boot = await request(app).get('/api/auth/me').set('Cookie', [`cat_refresh_token=${storedToken}`]);
    expect(boot.status).toBe(401);

    // Step 2 — the wrapper's silent refresh succeeds and rotates the cookie.
    const refreshed = await request(app).post('/api/auth/refresh').set('Cookie', [`cat_refresh_token=${storedToken}`]);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.user.email).toBe('usher@test.app');
    const newAccess = cookieValue(refreshed, 'cat_access_token');
    const newRefresh = cookieValue(refreshed, 'cat_refresh_token');
    expect(newAccess).toBeTruthy();
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(storedToken);

    // Step 3 — the retry with the new access cookie serves the real data.
    const retry = await request(app).get('/api/auth/me').set('Cookie', [`cat_access_token=${newAccess}`]);
    expect(retry.status).toBe(200);
    expect(retry.body.user.email).toBe('usher@test.app');
    expect(seen).toEqual([]);
  });

  test('a revoked refresh token ends the session and clears both cookies', async () => {
    script([
      { match: 'SELECT * FROM refresh_tokens', rows: [{ id: 3, user_id: 7, token_hash: 'x', revoked_at: new Date(), expires_at: new Date(Date.now() + DAY_MS) }] },
    ]);

    const res = await request(app).post('/api/auth/refresh').set('Cookie', ['cat_refresh_token=dead-token']);
    expect(res.status).toBe(401);
    // Both cookies are expired, so a stale browser cannot retry forever.
    expect(cookieHeader(res, 'cat_refresh_token')).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    expect(cookieHeader(res, 'cat_access_token')).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });
});