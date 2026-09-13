const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vEmail, vStr, vEnum, vInt } = require('../utils/validate');
const { hashPassword, generateTempPassword } = require('../utils/passwords');
const { authenticate, requireAdmin, getBranchFilter } = require('../middleware/auth');
const { sha256 } = require('../utils/tokens');

const router = express.Router();
// Every user-management route is admin-only, enforced on the server.
router.use(authenticate, requireAdmin);

function cleanUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    username: u.username || null,
    phone: u.phone,
    role: u.role,
    status: u.status,
    branch_id: u.branch_id,
    branch_name: u.branch_name || null,
    must_change_password: u.must_change_password,
    last_login_at: u.last_login_at,
    created_by_name: u.created_by_name || null,
    records_created: Number(u.records_created || 0),
    created_at: u.created_at,
  };
}

async function findUser(id) {
  const { rows } = await db.query(
    `SELECT u.*, c.name AS created_by_name, b.name AS branch_name,
            (SELECT COUNT(*) FROM attendance a WHERE a.recorded_by_user_id = u.id) AS records_created
       FROM users u
       LEFT JOIN users c ON c.id = u.created_by
       LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.id = $1`,
    [id]
  );
  return rows[0];
}

/** Optional username: 3-40 chars (letters, numbers, dot, hyphen, underscore), unique. */
async function checkUsername(raw, currentId = null) {
  if (raw === undefined || raw === null) return undefined; // not provided -> keep as-is
  const value = String(raw).trim();
  if (!value) return null; // provided but empty -> clear it
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(value)) {
    throw new ApiError(400, 'Usernames use 3-40 letters, numbers, dots, hyphens or underscores.', [
      { field: 'username', message: 'Invalid username.' },
    ]);
  }
  const dup = await db.query(
    'SELECT id FROM users WHERE lower(username) = lower($1) AND id <> $2',
    [value, currentId || 0]
  );
  if (dup.rows.length) throw new ApiError(409, 'That username is already taken.');
  return value;
}
router.get('/', asyncHandler(async (req, res) => {
  const branchFilter = getBranchFilter(req);
  
  let query = `SELECT u.*, c.name AS created_by_name, b.name AS branch_name,
            (SELECT COUNT(*) FROM attendance a WHERE a.recorded_by_user_id = u.id) AS records_created
         FROM users u
         LEFT JOIN users c ON c.id = u.created_by
         LEFT JOIN branches b ON b.id = u.branch_id`;
  
  const params = [];
  const conditions = [];
  
  // Filter by branch for non-district admins
  if (req.user.role !== 'district_admin' && req.user.branch_id) {
    conditions.push(`u.branch_id = $${params.length + 1}`);
    params.push(req.user.branch_id);
  } else if (req.query.branchId) {
    conditions.push(`u.branch_id = $${params.length + 1}`);
    params.push(Number(req.query.branchId));
  }
  
  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }
  
  query += ` ORDER BY CASE u.role WHEN 'district_admin' THEN 0 WHEN 'branch_admin' THEN 1 ELSE 2 END, u.name ASC`;
  
  const { rows } = await db.query(query, params);
  res.json({ items: rows.map(cleanUser), total: rows.length });
}));

router.post('/', asyncHandler(async (req, res) => {
  const name = vStr(req.body, 'name', { required: true, max: 120, label: 'Full name' });
  const email = vEmail(req.body, 'email', { required: true });
  const phone = vStr(req.body, 'phone', { max: 40 });
  const role = vEnum(req.body, 'role', ['district_admin', 'branch_admin', 'usher']) || 'usher';
  const branchId = vInt(req.body, 'branchId');

  // Validate branch_id based on role
  if (role === 'district_admin' && branchId) {
    throw new ApiError(400, 'District admin should not be assigned to a branch.');
  }
  if ((role === 'branch_admin' || role === 'usher') && !branchId) {
    throw new ApiError(400, 'Branch admin and usher must be assigned to a branch.');
  }

  // Verify branch exists
  if (branchId) {
    const branchCheck = await db.query('SELECT id FROM branches WHERE id = $1 AND status = ''active''', [branchId]);
    if (!branchCheck.rows.length) throw new ApiError(400, 'Invalid or inactive branch.');
  }

  // Branch admin can only create users in their own branch
  if (req.user.role === 'branch_admin' && branchId !== req.user.branch_id) {
    throw new ApiError(403, 'You can only create users in your own branch.');
  }

  const dup = await db.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
  if (dup.rows.length) throw new ApiError(409, 'A user account with this email already exists.');
  const username = (await checkUsername(req.body ? req.body.username : undefined, null)) ?? null;

  // Admin issues credentials: we generate a one-time temporary password.
  const temporaryPassword = generateTempPassword();
  const hash = await hashPassword(temporaryPassword);
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, username, password_hash, role, must_change_password, created_by, branch_id)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8)
     RETURNING id`,
    [name, email, phone, username, hash, role, req.user.id, branchId || null]
  );
  const user = await findUser(rows[0].id);
  res.status(201).json({ user: cleanUser(user), temporaryPassword });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await findUser(id);
  if (!existing) throw new ApiError(404, 'User not found.');

  const name = vStr(req.body, 'name', { required: true, max: 120, label: 'Full name' });
  const email = vEmail(req.body, 'email', { required: true });
  const phone = vStr(req.body, 'phone', { max: 40 });
  const branchId = vInt(req.body, 'branchId');

  // Validate branch change
  if (branchId !== undefined && branchId !== existing.branch_id) {
    if (existing.role === 'district_admin') {
      throw new ApiError(400, 'District admin cannot be assigned to a branch.');
    }
    if (branchId) {
      const branchCheck = await db.query('SELECT id FROM branches WHERE id = $1 AND status = ''active''', [branchId]);
      if (!branchCheck.rows.length) throw new ApiError(400, 'Invalid or inactive branch.');
    }
    // Branch admin can only assign to their own branch
    if (req.user.role === 'branch_admin' && branchId !== req.user.branch_id) {
      throw new ApiError(403, 'You can only assign users to your own branch.');
    }
  }

  const dup = await db.query('SELECT id FROM users WHERE lower(email) = $1 AND id <> $2', [email, id]);
  if (dup.rows.length) throw new ApiError(409, 'Another account already uses this email.');

  await db.query(
    'UPDATE users SET name = $1, email = $2, phone = $3, branch_id = $4 WHERE id = $5',
    [name, email, phone, branchId !== undefined ? branchId : existing.branch_id, id]
  );
  res.json({ user: cleanUser(await findUser(id)) });
}));

router.patch('/:id/status', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const status = vEnum(req.body, 'status', ['active', 'inactive'], { required: true });
  const existing = await findUser(id);
  if (!existing) throw new ApiError(404, 'User not found.');
  if (id === req.user.id && status === 'inactive') {
    throw new ApiError(400, 'You cannot deactivate your own account.');
  }
  if (['district_admin', 'branch_admin'].includes(existing.role) && status === 'inactive') {
    const { rows } = await db.query(
      `SELECT COUNT(*) AS n FROM users WHERE role IN ('district_admin', 'branch_admin') AND status = 'active' AND id <> $1`,
      [id]
    );
    if (Number(rows[0].n) === 0) {
      throw new ApiError(400, 'At least one active admin must remain.');
    }
  }
  await db.query('UPDATE users SET status = $1 WHERE id = $2', [status, id]);
  if (status === 'inactive') {
    await db.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [id]
    );
  }
  res.json({ user: cleanUser(await findUser(id)) });
}));

router.post('/:id/reset-password', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await findUser(id);
  if (!existing) throw new ApiError(404, 'User not found.');

  const temporaryPassword = generateTempPassword();
  const hash = await hashPassword(temporaryPassword);
  await db.query(
    'UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE id = $2',
    [hash, id]
  );
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [id]
  );
  res.json({ temporaryPassword, user: cleanUser(await findUser(id)) });
}));

router.get('/:id/attendance-records', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await findUser(id);
  if (!existing) throw new ApiError(404, 'User not found.');

  const { rows: totalsRows } = await db.query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE a.status = 'present') AS present,
            COUNT(*) FILTER (WHERE a.status = 'absent')  AS absent,
            COUNT(*) FILTER (WHERE a.status = 'excused') AS excused
       FROM attendance a WHERE a.recorded_by_user_id = $1`,
    [id]
  );
  const t = totalsRows[0];
  const { rows: items } = await db.query(
    `SELECT a.id, a.status, a.notes, a.recorded_at, a.updated_at,
            m.full_name AS member_name, s.service_date, s.service_name
       FROM attendance a
       JOIN members m ON m.id = a.member_id
       JOIN services s ON s.id = a.service_id
      WHERE a.recorded_by_user_id = $1
      ORDER BY a.recorded_at DESC
      LIMIT 50`,
    [id]
  );
  res.json({
    totals: {
      total: Number(t.total),
      present: Number(t.present),
      absent: Number(t.absent),
      excused: Number(t.excused),
    },
    items,
  });
}));

module.exports = router;