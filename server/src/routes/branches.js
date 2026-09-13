const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vStr, vEmail } = require('../utils/validate');
const { authenticate, requireDistrictAdmin, requireAdmin } = require('../middleware/auth');

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
    member_count: Number(b.member_count || 0),
    user_count: Number(b.user_count || 0),
    created_at: b.created_at,
    updated_at: b.updated_at,
  };
}

// GET /api/branches - list branches
// District admin sees all, branch admin sees only their own
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT b.*,
            (SELECT COUNT(*) FROM members m WHERE m.branch_id = b.id AND m.status = 'active') AS member_count,
            (SELECT COUNT(*) FROM users u WHERE u.branch_id = b.id AND u.status = 'active') AS user_count
       FROM branches b
      WHERE b.status = 'active'
      ORDER BY b.name ASC`
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
  if (!rows[0]) throw new ApiError(404, 'Branch not found.');
  res.json({ branch: cleanBranch(rows[0]) });
}));

// POST /api/branches - create branch (district admin only)
router.post('/', requireDistrictAdmin, asyncHandler(async (req, res) => {
  const name = vStr(req.body, 'name', { required: true, max: 120, label: 'Branch name' });
  const description = vStr(req.body, 'description', { max: 500 });
  const location = vStr(req.body, 'location', { max: 200 });
  const contactPhone = vStr(req.body, 'contactPhone', { max: 40 });
  const contactEmail = vStr(req.body, 'contactEmail', { max: 120 });

  // Check for duplicate name
  const dup = await db.query('SELECT id FROM branches WHERE lower(name) = lower($1)', [name]);
  if (dup.rows.length) throw new ApiError(409, 'A branch with this name already exists.');

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
  if (!existing.rows[0]) throw new ApiError(404, 'Branch not found.');

  const name = vStr(req.body, 'name', { required: true, max: 120, label: 'Branch name' });
  const description = vStr(req.body, 'description', { max: 500 });
  const location = vStr(req.body, 'location', { max: 200 });
  const contactPhone = vStr(req.body, 'contactPhone', { max: 40 });
  const contactEmail = vStr(req.body, 'contactEmail', { max: 120 });

  // Check for duplicate name (excluding current branch)
  const dup = await db.query('SELECT id FROM branches WHERE lower(name) = lower($1) AND id <> $2', [name, id]);
  if (dup.rows.length) throw new ApiError(409, 'A branch with this name already exists.');

  const { rows } = await db.query(
    `UPDATE branches
        SET name = $1, description = $2, location = $3, contact_phone = $4, contact_email = $5
      WHERE id = $6
      RETURNING *`,
    [name, description || null, location || null, contactPhone || null, contactEmail || null, id]
  );
  res.json({ branch: cleanBranch(rows[0]) });
}));

// DELETE /api/branches/:id - deactivate branch (district admin only)
router.delete('/:id', requireDistrictAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.query('SELECT * FROM branches WHERE id = $1', [id]);
  if (!existing.rows[0]) throw new ApiError(404, 'Branch not found.');

  // Check if branch has members or users
  const { rows: countRows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM members WHERE branch_id = $1) AS member_count,
       (SELECT COUNT(*) FROM users WHERE branch_id = $1) AS user_count`,
    [id]
  );
  if (Number(countRows[0].member_count) > 0 || Number(countRows[0].user_count) > 0) {
    throw new ApiError(400, 'Cannot delete a branch that has members or users. Please reassign them first.');
  }

  await db.query("UPDATE branches SET status = 'inactive' WHERE id = $1", [id]);
  res.status(204).end();
}));

module.exports = router;
