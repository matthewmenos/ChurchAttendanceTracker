const db = require('../config/db');
const { ApiError } = require('../utils/errors');
const { verifyAccessToken } = require('../utils/tokens');

const ACCESS_COOKIE = 'cat_access_token';
const REFRESH_COOKIE = 'cat_refresh_token';

function readAccessToken(req) {
  if (req.cookies && req.cookies[ACCESS_COOKIE]) return req.cookies[ACCESS_COOKIE];
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Verifies the access token and loads a fresh, active user on every request. */
async function authenticate(req, res, next) {
  try {
    const token = readAccessToken(req);
    if (!token) throw new ApiError(401, 'Authentication required. Please sign in.');
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (e) {
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }
    const { rows } = await db.query(
      'SELECT id, name, email, role, status, must_change_password, last_login_at, local_id FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = rows[0];
    if (!user) throw new ApiError(401, 'Account not found.');
    if (user.status !== 'active') throw new ApiError(403, 'This account has been deactivated.');
    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || !['district_admin', 'local_admin'].includes(req.user.role)) {
    return next(new ApiError(403, 'Admin access is required for this action.'));
  }
  return next();
}

function requireDistrictAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'district_admin') {
    return next(new ApiError(403, 'District admin access is required for this action.'));
  }
  return next();
}

function requireLocalAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'local_admin' && req.user.role !== 'district_admin')) {
    return next(new ApiError(403, 'Local admin access is required for this action.'));
  }
  return next();
}

/**
 * Returns the local_id filter for the current request.
 * District admins can override with ?localId= query param (null = all locals).
 * Other users are hard-scoped to their own local. -1 matches nothing, so a
 * misconfigured account (no local assigned) sees no data instead of everything.
 */
function getLocalFilter(req, params = {}) {
  if (req.user.role === 'district_admin') {
    return req.query.localId ? Number(req.query.localId) : null;
  }
  return req.user.local_id || -1;
}

const ADMIN_ROLES = ['district_admin', 'local_admin'];

function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

/**
 * Throws 403 unless the user may view/act on data belonging to localId.
 * District admins may access any local; everyone else only their own.
 */
function assertLocalAccess(user, localId) {
  if (!user) throw new ApiError(401, 'Authentication required. Please sign in.');
  if (user.role === 'district_admin') return;
  if (localId != null && Number(user.local_id) === Number(localId)) return;
  throw new ApiError(403, 'You do not have access to this local.');
}

module.exports = { authenticate, requireAdmin, requireDistrictAdmin, requireLocalAdmin, getLocalFilter, assertLocalAccess, isAdminRole, ADMIN_ROLES, ACCESS_COOKIE, REFRESH_COOKIE };

