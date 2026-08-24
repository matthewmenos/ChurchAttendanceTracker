const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vEmail, vStr, vEnum } = require('../utils/validate');
const { hashPassword, generateTempPassword } = require('../utils/passwords');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { sha256 } = require('../utils/tokens');

const router = express.Router();
// Every user-management route is admin-only, enforced on the server.
router.use(authenticate, requireAdmin);

function cleanUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    must_change_password: u.must_change_password,
    last_login_at: u.last_login_at,
    created_by_name: u.created_by_name || null,
    records_created: Number(u.records_created || 0),
    created_at: u.created_at,
  };
}

async function findUser(id) {
  const { rows } = await db.query(
    `SELECT u.*, c.name AS created_by_name,
            (SELECT COUNT(*) FROM attendance a WHERE a.recorded_by_user_id = u.id) AS records_created
       FROM users u
       LEFT JOIN users c ON c.id = u.created_by
      WHERE u.id = $1`,
    [id]
  );
  return rows[0];
}

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.*, c.name AS created_by_name,
            (SELECT COUNT(*) FROM attendance a WHERE a.recorded_by_user_id = u.id) AS records_created
       FROM users u
       LEFT JOIN users c ON c.id = u.created_by
      ORDER BY CASE u.role WHEN 'admin' THEN 0 ELSE 1 END, u.name ASC`
  );
  res.json({ items: rows.map(cleanUser), total: rows.length });
}));

router.post('/', asyncHandler(async (req, res) => {
  const name = vStr(req.body, 'name', { required: true, max: 120, label: 'Full name' });
  const email = vEmail(req.body, 'email', { required: true });
  const phone = vStr(req.body, 'phone', { max: 40 });
  const role = vEnum(req.body, 'role', ['admin', 'usher']) || 'usher';

  const dup = await db.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
  if (dup.rows.length) throw new ApiError(409, 'A user account with this email already exists.');

  // Admin issues credentials: we generate a one-time temporary password.
  const temporaryPassword = generateTempPassword();
  const hash = await hashPassword(temporaryPassword);
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, role, must_change_password, created_by)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6)
     RETURNING id`,
    [name, email, phone, hash, role, req.user.id]
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

  const dup = await db.query('SELECT id FROM users WHERE lower(email) = $1 AND id <> $2', [email, id]);
  if (dup.rows.length) throw new ApiError(409, 'Another account already uses this email.');

  await db.query('UPDATE users SET name = $1, email = $2, phone = $3 WHERE id = $4', [name, email, phone, id]);
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
  if (existing.role === 'admin' && status === 'inactive') {
    const { rows } = await db.query(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1`,
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