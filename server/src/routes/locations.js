const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vStr } = require('../utils/validate');
const { authenticate, requireAdmin, getBranchFilter } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const branchId = getBranchFilter(req);
  
  let query = `SELECT l.*, (SELECT COUNT(*) FROM services s WHERE s.location_id = l.id) AS service_count
                 FROM locations l`;
  const params = [];
  
  if (branchId) {
    params.push(branchId);
    query += ` WHERE l.branch_id = $1`;
  }
  
  query += ` ORDER BY l.name ASC`;
  
  const { rows } = await db.query(query, params);
  res.json({ items: rows.map((l) => ({ ...l, service_count: Number(l.service_count) })) });
}));

router.post('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const name = vStr(req.body, 'name', { required: true, max: 80 });
  const description = vStr(req.body, 'description', { max: 300 });
  
  // Determine branch_id
  let branchId = req.user.branch_id;
  if (req.user.role === 'district_admin' && req.body.branchId) {
    branchId = Number(req.body.branchId);
  }
  if (!branchId) {
    throw new ApiError(400, 'Cannot create location: no branch assigned.');
  }
  
  const dup = await db.query('SELECT id FROM locations WHERE lower(name) = $1 AND branch_id = $2', [name.toLowerCase(), branchId]);
  if (dup.rows.length) throw new ApiError(409, 'A location with this name already exists in this branch.');
  const { rows } = await db.query(
    'INSERT INTO locations (name, description, branch_id) VALUES ($1, $2, $3) RETURNING *',
    [name, description, branchId]
  );
  res.status(201).json({ item: rows[0] });
}));

router.put('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const name = vStr(req.body, 'name', { required: true, max: 80 });
  const description = vStr(req.body, 'description', { max: 300 });
  const dup = await db.query('SELECT id FROM locations WHERE lower(name) = $1 AND id <> $2', [name.toLowerCase(), id]);
  if (dup.rows.length) throw new ApiError(409, 'A location with this name already exists.');
  const { rows } = await db.query(
    'UPDATE locations SET name = $1, description = $2 WHERE id = $3 RETURNING *',
    [name, description, id]
  );
  if (!rows.length) throw new ApiError(404, 'Location not found.');
  res.json({ item: rows[0] });
}));

router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM locations WHERE id = $1', [Number(req.params.id)]);
  if (!rowCount) throw new ApiError(404, 'Location not found.');
  res.status(204).end();
}));

module.exports = router;