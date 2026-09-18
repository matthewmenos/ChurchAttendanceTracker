const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vStr, vEmail } = require('../utils/validate');
const { authenticate, requireDistrictAdmin, requireAdmin, assertBranchAccess } = require('../middleware/auth');

const router = express.Router();

// All branch routes require authentication
router.use(authenticate);

function cleanBranch(b) {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    location: b.location,
    contact_phone: b.contact_phone,
    contact_email: b.contact_email,
    status: b.status,
    allow_usher_add_member: !!b.allow_usher_add_member,
    member_count: Number(b.member_count || 0),
    user_count: Number(b.user_count || 0),
    created_at: b.created_at,
    updated_at: b.updated_at,
  };
}

// GET /api/branches - list branches
// District admin sees all; branch admins & ushers only their own branch.
router.get('/', asyncHandler(async (req, res) => {
  const params = [];
  let whereSql = `WHERE b.status = 'active'`;
  if (req.user.role !== 'district_admin') {
    params.push(req.user.branch_id || -1);
    whereSql += ` AND b.id = $1`;
  }
  const { rows } = await db.query(
    `SELECT b.*,
            (SELECT COUNT(*) FROM members m WHERE m.branch_id = b.id AND m.status = 'active') AS member_count,
            (SELECT COUNT(*) FROM users u WHERE u.branch_id = b.id AND u.status = 'active') AS user_count
       FROM branches b
      ${whereSql}
      ORDER BY b.name ASC`,
    params
  );
  res.json({ items: rows.map(cleanBranch), total: rows.length });
}));

// GET /api/branches/:id - get single branch
router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await db.query(
    `SELECT b.*,
            (SELECT COUNT(*) FROM members m WHERE m.branch_id = b.id AND m.status = 'active') AS member_count,
            (SELECT COUNT(*) FROM users u WHERE u.branch_id = b.id AND u.status = 'active') AS user_count
       FROM branches b
      WHERE b.id = $1`,
    [id]
  );
  if (!rows[0]) throw new ApiError(404, 'Local not found.');
  if (req.user.role !== 'district_admin' && req.user.branch_id !== rows[0].id) {
    throw new ApiError(403, 'You do not have access to this local.');
  }
  res.json({ branch: cleanBranch(rows[0]) });
}));

// POST /api/branches - create branch (district admin only)
router.post('/', requireDistrictAdmin, asyncHandler(async (req, res) => {
  const name = vStr(req.body, 'name', { required: true, max: 120, label: 'Local name' });
  const description = vStr(req.body, 'description', { max: 500 });
  const location = vStr(req.body, 'location', { max: 200 });
  const contactPhone = vStr(req.body, 'contactPhone', { max: 40 });
  const contactEmail = vStr(req.body, 'contactEmail', { max: 120 });

  // Check for duplicate name
  const dup = await db.query('SELECT id FROM branches WHERE lower(name) = lower($1)', [name]);
  if (dup.rows.length) throw new ApiError(409, 'A local with this name already exists.');

  const { rows } = await db.query(
    `INSERT INTO branches (name, description, location, contact_phone, contact_email)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, description || null, location || null, contactPhone || null, contactEmail || null]
  );
  res.status(201).json({ branch: cleanBranch({ ...rows[0], member_count: 0, user_count: 0 }) });
}));

// PUT /api/branches/:id - update branch (district admin only)
router.put('/:id', requireDistrictAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.query('SELECT * FROM branches WHERE id = $1', [id]);
  if (!existing.rows[0]) throw new ApiError(404, 'Local not found.');

  const name = vStr(req.body, 'name', { required: true, max: 120, label: 'Local name' });
  const description = vStr(req.body, 'description', { max: 500 });
  const location = vStr(req.body, 'location', { max: 200 });
  const contactPhone = vStr(req.body, 'contactPhone', { max: 40 });
  const contactEmail = vStr(req.body, 'contactEmail', { max: 120 });

  // Check for duplicate name (excluding current branch)
  const dup = await db.query('SELECT id FROM branches WHERE lower(name) = lower($1) AND id <> $2', [name, id]);
  if (dup.rows.length) throw new ApiError(409, 'A local with this name already exists.');

  const { rows } = await db.query(
    `UPDATE branches
        SET name = $1, description = $2, location = $3, contact_phone = $4, contact_email = $5
      WHERE id = $6
      RETURNING *`,
    [name, description || null, location || null, contactPhone || null, contactEmail || null, id]
  );
  res.json({ branch: cleanBranch(rows[0]) });
}));

// PATCH /api/branches/:id/allow-usher-add
// Per-branch switch: may ushers of this branch add members?
// The branch's own admin decides; district admin may also set it.
router.patch('/:id/allow-usher-add', requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.role !== 'district_admin') {
    assertBranchAccess(req.user, id);
  }
  const enabled = !!req.body && ['1', 'true'].includes(String(req.body.enabled).toLowerCase());
  const { rows } = await db.query(
    `UPDATE branches SET allow_usher_add_member = $1 WHERE id = $2 AND status = 'active' RETURNING id, allow_usher_add_member`,
    [enabled, id]
  );
  if (!rows[0]) throw new ApiError(404, 'Local not found.');
  res.json({ branch: { id: rows[0].id, allow_usher_add_member: !!rows[0].allow_usher_add_member } });
}));

// DELETE /api/branches/:id - deactivate branch (district admin only)
router.delete('/:id', requireDistrictAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.query('SELECT * FROM branches WHERE id = $1', [id]);
  if (!existing.rows[0]) throw new ApiError(404, 'Local not found.');

  // Check if branch has members or users
  const { rows: countRows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM members WHERE branch_id = $1) AS member_count,
       (SELECT COUNT(*) FROM users WHERE branch_id = $1) AS user_count`,
    [id]
  );
  if (Number(countRows[0].member_count) > 0 || Number(countRows[0].user_count) > 0) {
    throw new ApiError(400, 'Cannot delete a local that has members or users. Please reassign them first.');
  }

  await db.query("UPDATE branches SET status = 'inactive' WHERE id = $1", [id]);
  res.status(204).end();
}));

module.exports = router;
