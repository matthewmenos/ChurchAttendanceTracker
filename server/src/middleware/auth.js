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
 * District admins can override with ?branchId= query param (null = all branches).
 * Other users are hard-scoped to their own branch. -1 matches nothing, so a
 * misconfigured account (no branch assigned) sees no data instead of everything.
 */
function getBranchFilter(req, params = {}) {
  if (req.user.role === 'district_admin') {
    return req.query.branchId ? Number(req.query.branchId) : null;
  }
  return req.user.branch_id || -1;
}

const ADMIN_ROLES = ['district_admin', 'branch_admin'];

function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

/**
 * Throws 403 unless the user may view/act on data belonging to branchId.
 * District admins may access any branch; everyone else only their own.
 */
function assertBranchAccess(user, branchId) {
  if (!user) throw new ApiError(401, 'Authentication required. Please sign in.');
  if (user.role === 'district_admin') return;
  if (branchId != null && Number(user.branch_id) === Number(branchId)) return;
  throw new ApiError(403, 'You do not have access to this branch.');
}

module.exports = { authenticate, requireAdmin, requireDistrictAdmin, requireBranchAdmin, getBranchFilter, assertBranchAccess, isAdminRole, ADMIN_ROLES, ACCESS_COOKIE, REFRESH_COOKIE };