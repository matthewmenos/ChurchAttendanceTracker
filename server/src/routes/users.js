const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vEmail, vStr, vEnum, vInt } = require('../utils/validate');
const { hashPassword, generateTempPassword } = require('../utils/passwords');
const { authenticate, requireAdmin, getLocalFilter } = require('../middleware/auth');
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
    local_id: u.local_id,
    local_name: u.local_name || null,
    must_change_password: u.must_change_password,
    last_login_at: u.last_login_at,
    created_by_name: u.created_by_name || null,
    records_created: Number(u.records_created || 0),
    created_at: u.created_at,
  };
}

async function findUser(id) {
  const { rows } = await db.query(
    `SELECT u.*, c.name AS created_by_name, b.name AS local_name,
            (SELECT COUNT(*) FROM attendance a WHERE a.recorded_by_user_id = u.id) AS records_created
       FROM users u
       LEFT JOIN users c ON c.id = u.created_by
       LEFT JOIN locals b ON b.id = u.local_id
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
  const localFilter = getLocalFilter(req);
  
  let query = `SELECT u.*, c.name AS created_by_name, b.name AS local_name,
            (SELECT COUNT(*) FROM attendance a WHERE a.recorded_by_user_id = u.id) AS records_created
         FROM users u
         LEFT JOIN users c ON c.id = u.created_by
         LEFT JOIN locals b ON b.id = u.local_id`;
  
  const params = [];
  const conditions = [];
  
  // Filter by local for non-district admins
  if (req.user.role !== 'district_admin' && req.user.local_id) {
    conditions.push(`u.local_id = $${params.length + 1}`);
    params.push(req.user.local_id);
  } else if (req.query.localId) {
    conditions.push(`u.local_id = $${params.length + 1}`);
    params.push(Number(req.query.localId));
  }
  
  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }
  
  query += ` ORDER BY CASE u.role WHEN 'district_admin' THEN 0 WHEN 'local_admin' THEN 1 ELSE 2 END, u.name ASC`;
  
  const { rows } = await db.query(query, params);
  res.json({ items: rows.map(cleanUser), total: rows.length });
}));

router.post('/', asyncHandler(async (req, res) => {
  const name = vStr(req.body, 'name', { required: true, max: 120, label: 'Full name' });
  const email = vEmail(req.body, 'email', { required: true });
  const phone = vStr(req.body, 'phone', { max: 40 });
  const role = vEnum(req.body, 'role', ['district_admin', 'local_admin', 'usher']) || 'usher';
  let localId = vInt(req.body, 'localId');

  // Local admins always operate inside their own local: when the client
  // doesn't send a localId we default to theirs, and any other value is
  // rejected (they may not place ushers in another local).
  if (req.user.role === 'local_admin') {
    if (!localId) localId = req.user.local_id || null;
    if (!localId) {
      throw new ApiError(400, 'Your account has no local assigned. Ask a district admin to set your local first.');
    }
    if (localId !== req.user.local_id) {
      throw new ApiError(403, 'You can only create users in your own local.');
    }
  }

  // Validate local_id based on role
  if (role === 'district_admin' && localId) {
    throw new ApiError(400, 'District admin should not be assigned to a local.');
  }
  if ((role === 'local_admin' || role === 'usher') && !localId) {
    throw new ApiError(400, 'Local admin and usher must be assigned to a local.');
  }

  // Verify local exists
  if (localId) {
    const localCheck = await db.query(`SELECT id FROM locals WHERE id = $1 AND status = 'active'`, [localId]);
    if (!localCheck.rows.length) throw new ApiError(400, 'Invalid or inactive local.');
  }

  // Local admins manage ushers within their own local only.
  if (req.user.role === 'local_admin') {
    if (role !== 'usher') {
      throw new ApiError(403, 'Local admins can only create usher accounts.');
    }
    if (localId !== req.user.local_id) {
      throw new ApiError(403, 'You can only create users in your own local.');
    }
  }

  const dup = await db.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
  if (dup.rows.length) throw new ApiError(409, 'A user account with this email already exists.');
  const username = (await checkUsername(req.body ? req.body.username : undefined, null)) ?? null;

  // Admin issues credentials: we generate a one-time temporary password.
  const temporaryPassword = generateTempPassword();
  const hash = await hashPassword(temporaryPassword);
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, username, password_hash, role, must_change_password, created_by, local_id)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8)
     RETURNING id`,
    [name, email, phone, username, hash, role, req.user.id, localId || null]
  );
  const user = await findUser(rows[0].id);
  res.status(201).json({ user: cleanUser(user), temporaryPassword });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await findUser(id);
  if (!existing) throw new ApiError(404, 'User not found.');

  // Local admins manage ushers in their own local only.
  if (req.user.role === 'local_admin') {
    if (existing.role !== 'usher') {
      throw new ApiError(403, 'Local admins can only manage usher accounts.');
    }
    if (existing.local_id !== req.user.local_id) {
      throw new ApiError(403, 'You can only manage users in your own local.');
    }
  }

  const name = vStr(req.body, 'name', { required: true, max: 120, label: 'Full name' });
  const email = vEmail(req.body, 'email', { required: true });
  const phone = vStr(req.body, 'phone', { max: 40 });
  const localId = vInt(req.body, 'localId');
  const requestedRole = vEnum(req.body, 'role', ['district_admin', 'local_admin', 'usher']);

  // vInt/vEnum return null both when a field is absent and when it is explicitly
  // empty, so presence must be checked on the raw body. Without this, saving a
  // user would blank fields the caller never sent.
  const has = (field) => !!req.body && Object.prototype.hasOwnProperty.call(req.body, field);
  const localProvided = has('localId');
  const roleProvided = has('role');

  // Re-assigning a role re-scopes everything the account can reach, so it stays a
  // district-admin-only action (and never on your own account).
  let role = existing.role;
  if (roleProvided && requestedRole && requestedRole !== existing.role) {
    if (req.user.role !== 'district_admin') {
      throw new ApiError(403, 'Only a district admin can change a user role.');
    }
    if (id === req.user.id) {
      throw new ApiError(400, 'You cannot change your own role.');
    }
    role = requestedRole;
  }

  // The local that applies once this request is saved.
  const nextLocalId = localProvided ? localId : existing.local_id;
  if (role === 'district_admin') {
    if (nextLocalId) throw new ApiError(400, 'District admin cannot be assigned to a local.');
  } else if (!nextLocalId) {
    throw new ApiError(400, 'Local admin and usher must be assigned to a local.');
  }

  if (nextLocalId !== existing.local_id) {
    const localCheck = await db.query(`SELECT id FROM locals WHERE id = $1 AND status = 'active'`, [nextLocalId]);
    if (!localCheck.rows.length) throw new ApiError(400, 'Invalid or inactive local.');
    // Local admin can only assign to their own local
    if (req.user.role === 'local_admin' && nextLocalId !== req.user.local_id) {
      throw new ApiError(403, 'You can only assign users to your own local.');
    }
  }

  const dup = await db.query('SELECT id FROM users WHERE lower(email) = $1 AND id <> $2', [email, id]);
  if (dup.rows.length) throw new ApiError(409, 'Another account already uses this email.');

  await db.query(
    'UPDATE users SET name = $1, email = $2, phone = $3, local_id = $4, role = $5 WHERE id = $6',
    [name, email, phone, nextLocalId || null, role, id]
  );
  res.json({ user: cleanUser(await findUser(id)) });
}));

router.patch('/:id/status', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const status = vEnum(req.body, 'status', ['active', 'inactive'], { required: true });
  const existing = await findUser(id);
  if (!existing) throw new ApiError(404, 'User not found.');
  if (req.user.role === 'local_admin' && (existing.role !== 'usher' || existing.local_id !== req.user.local_id)) {
    throw new ApiError(403, 'You can only manage ushers in your own local.');
  }
  if (id === req.user.id && status === 'inactive') {
    throw new ApiError(400, 'You cannot deactivate your own account.');
  }
  if (['district_admin', 'local_admin'].includes(existing.role) && status === 'inactive') {
    const { rows } = await db.query(
      `SELECT COUNT(*) AS n FROM users WHERE role IN ('district_admin', 'local_admin') AND status = 'active' AND id <> $1`,
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
  if (req.user.role === 'local_admin' && (existing.role !== 'usher' || existing.local_id !== req.user.local_id)) {
    throw new ApiError(403, 'You can only manage ushers in your own local.');
  }

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
  if (req.user.role === 'local_admin' && (existing.role !== 'usher' || existing.local_id !== req.user.local_id)) {
    throw new ApiError(403, 'You can only manage ushers in your own local.');
  }

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

