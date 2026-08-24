const express = require('express');
const db = require('../config/db');
const env = require('../config/env');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vStr } = require('../utils/validate');
const { verifyPassword, hashPassword } = require('../utils/passwords');
const { sha256, signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/tokens');
const { authenticate, ACCESS_COOKIE, REFRESH_COOKIE } = require('../middleware/auth');

const router = express.Router();

// ---------- tiny in-memory login rate limiter ----------
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map();

function tooManyAttempts(key) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordAttempt(key) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

function clearAttempts(key) {
  attempts.delete(key);
}

// ---------- cookies ----------
function cookieOpts(maxAgeMs) {
  return { httpOnly: true, secure: env.cookieSecure, sameSite: env.cookieSameSite, path: '/', maxAge: maxAgeMs };
}

function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOpts(env.accessTtlMinutes * 60 * 1000));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOpts(env.refreshTokenTtlDays * 24 * 60 * 60 * 1000));
}

function clearAuthCookies(res) {
  const opts = { httpOnly: true, secure: env.cookieSecure, sameSite: env.cookieSameSite, path: '/' };
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, opts);
}

// ---------- helpers ----------
async function loadPublicUser(id) {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.username, u.role, u.status, u.must_change_password, u.last_login_at,
            (SELECT value FROM settings WHERE key = 'church_name') AS church_name
       FROM users u
      WHERE u.id = $1`,
    [id]
  );
  const u = rows[0];
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    username: u.username || null,
    role: u.role,
    status: u.status,
    must_change_password: u.must_change_password,
    last_login_at: u.last_login_at,
    churchName: u.church_name || 'Church Attendance Tracker',
  };
}

async function startSession(res, user) {
  const accessToken = signAccessToken(user);
  const { token: refreshToken, expiresAt } = signRefreshToken();
  await db.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [user.id, sha256(refreshToken), expiresAt]
  );
  setAuthCookies(res, accessToken, refreshToken);
}

// ---------- routes ----------
router.post('/login', asyncHandler(async (req, res) => {
  // The sign-in field accepts an email address OR a username.
  const identifier = vStr(req.body, 'email', { required: true, max: 200, label: 'Email or username' }).toLowerCase();
  const password = vStr(req.body, 'password', { required: true, max: 200 });

  const key = `${req.ip}:${identifier}`;
  if (tooManyAttempts(key)) {
    throw new ApiError(429, 'Too many sign-in attempts. Please try again in a few minutes.');
  }

  const { rows } = await db.query(
    'SELECT * FROM users WHERE lower(email) = $1 OR (username IS NOT NULL AND lower(username) = $1) LIMIT 1',
    [identifier]
  );
  const user = rows[0];
  const passwordOk = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !passwordOk) {
    recordAttempt(key);
    // Same message either way so accounts cannot be enumerated.
    throw new ApiError(401, 'Incorrect email or password.');
  }
  if (user.status !== 'active') {
    throw new ApiError(403, 'This account has been deactivated. Contact your administrator.');
  }

  clearAttempts(key);
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await startSession(res, user);
  res.json({ user: await loadPublicUser(user.id) });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const token = req.cookies ? req.cookies[REFRESH_COOKIE] : null;
  if (!token) throw new ApiError(401, 'No active session.');

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch (e) {
    clearAuthCookies(res);
    throw new ApiError(401, 'Session expired. Please sign in again.');
  }

  const { rows } = await db.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [sha256(token)]);
  const stored = rows[0];
  if (!stored || stored.revoked_at || new Date(stored.expires_at).getTime() < Date.now()) {
    clearAuthCookies(res);
    throw new ApiError(401, 'Session expired. Please sign in again.');
  }

  const { rows: userRows } = await db.query('SELECT * FROM users WHERE id = $1', [payload.sub]);
  const user = userRows[0];
  if (!user || user.status !== 'active' || user.id !== stored.user_id) {
    clearAuthCookies(res);
    throw new ApiError(401, 'Account unavailable.');
  }

  // Rotate: old token dies, a fresh one is issued.
  await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [stored.id]);
  await startSession(res, user);
  res.json({ user: await loadPublicUser(user.id) });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  const token = req.cookies ? req.cookies[REFRESH_COOKIE] : null;
  if (token) {
    await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [sha256(token)]);
  }
  clearAuthCookies(res);
  res.json({ message: 'Signed out.' });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  res.json({ user: await loadPublicUser(req.user.id) });
}));

router.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const currentPassword = vStr(req.body, 'currentPassword', { required: true, max: 200 });
  const newPassword = vStr(req.body, 'newPassword', { required: true, min: 8, max: 200 });

  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const ok = rows[0] ? await verifyPassword(currentPassword, rows[0].password_hash) : false;
  if (!ok) {
    throw new ApiError(400, 'Your current password is incorrect.', [
      { field: 'currentPassword', message: 'Incorrect password.' },
    ]);
  }

  const hash = await hashPassword(newPassword);
  await db.query(
    'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2',
    [hash, req.user.id]
  );
  // Kill every other session, then hand this device a fresh one.
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [req.user.id]
  );
  await startSession(res, req.user);
  res.json({ message: 'Password updated successfully.', user: await loadPublicUser(req.user.id) });
}));

module.exports = router;