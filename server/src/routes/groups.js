const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vStr } = require('../utils/validate');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Reading groups is needed by ushers for the roster filter.
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT g.*, (SELECT COUNT(*) FROM member_group_assignments mga WHERE mga.group_id = g.id) AS member_count
       FROM member_groups g ORDER BY g.name ASC`
  );
  res.json({ items: rows.map((g) => ({ ...g, member_count: Number(g.member_count) })) });
}));

router.post('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const name = vStr(req.body, 'name', { required: true, max: 80 });
  const leaderName = vStr(req.body, 'leaderName', { max: 120 });
  const description = vStr(req.body, 'description', { max: 300 });
  const dup = await db.query('SELECT id FROM member_groups WHERE lower(name) = $1', [name.toLowerCase()]);
  if (dup.rows.length) throw new ApiError(409, 'A group with this name already exists.');
  const { rows } = await db.query(
    'INSERT INTO member_groups (name, leader_name, description) VALUES ($1, $2, $3) RETURNING *',
    [name, leaderName, description]
  );
  res.status(201).json({ item: rows[0] });
}));

router.put('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const name = vStr(req.body, 'name', { required: true, max: 80 });
  const leaderName = vStr(req.body, 'leaderName', { max: 120 });
  const description = vStr(req.body, 'description', { max: 300 });
  const dup = await db.query('SELECT id FROM member_groups WHERE lower(name) = $1 AND id <> $2', [name.toLowerCase(), id]);
  if (dup.rows.length) throw new ApiError(409, 'A group with this name already exists.');
  const { rows } = await db.query(
    'UPDATE member_groups SET name = $1, leader_name = $2, description = $3 WHERE id = $4 RETURNING *',
    [name, leaderName, description, id]
  );
  if (!rows.length) throw new ApiError(404, 'Group not found.');
  res.json({ item: rows[0] });
}));

router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM member_groups WHERE id = $1', [Number(req.params.id)]);
  if (!rowCount) throw new ApiError(404, 'Group not found.');
  // Members keep their records; group_id becomes NULL via ON DELETE SET NULL.
  res.status(204).end();
}));

module.exports = router;