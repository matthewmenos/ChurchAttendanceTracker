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
      'SELECT id, name, email, role, status, must_change_password, last_login_at, branch_id FROM users WHERE id = $1',
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
  if (!req.user || !['district_admin', 'branch_admin'].includes(req.user.role)) {
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

function requireBranchAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'branch_admin' && req.user.role !== 'district_admin')) {
    return next(new ApiError(403, 'Branch admin access is required for this action.'));
  }
  return next();
}

/**
 * Returns the branch_id filter for the current request.
 * District admins can override with ?branchId= query param.
 * Other users are restricted to their own branch.
 */
function getBranchFilter(req, params = {}) {
  if (req.user.role === 'district_admin' && req.query.branchId) {
    return Number(req.query.branchId);
  }
  if (req.user.branch_id) {
    return req.user.branch_id;
  }
  return null;
}

module.exports = { authenticate, requireAdmin, requireDistrictAdmin, requireBranchAdmin, getBranchFilter, ACCESS_COOKIE, REFRESH_COOKIE };