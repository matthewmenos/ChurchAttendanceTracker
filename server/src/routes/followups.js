const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vStr, vInt, vEnum, vDate } = require('../utils/validate');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireAdmin);

async function findFollowUp(id) {
  const { rows } = await db.query(
    `SELECT f.*, m.full_name AS member_name,
            COALESCE((
              SELECT string_agg(g.name, ', ' ORDER BY g.name)
                FROM member_group_assignments mga JOIN member_groups g ON g.id = mga.group_id
               WHERE mga.member_id = m.id
            ), '') AS group_name,
            m.consecutive_absences, u.name AS created_by_name
       FROM follow_ups f
       JOIN members m ON m.id = f.member_id
       LEFT JOIN users u ON u.id = f.created_by
      WHERE f.id = $1`,
    [id]
  );
  return rows[0];
}

router.get('/', asyncHandler(async (req, res) => {
  const priority = vEnum(req.query, 'priority', ['all', 'high', 'medium', 'low']) || 'all';
  const status = vEnum(req.query, 'status', ['all', 'open', 'closed']) || 'open';
  const memberId = vInt(req.query, 'memberId');

  const where = [];
  const params = [];
  if (priority !== 'all') { params.push(priority); where.push(`f.priority = $${params.length}`); }
  if (status !== 'all') { params.push(status); where.push(`f.status = $${params.length}`); }
  if (memberId) { params.push(memberId); where.push(`f.member_id = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT f.*, m.full_name AS member_name,
            COALESCE((
              SELECT string_agg(g.name, ', ' ORDER BY g.name)
                FROM member_group_assignments mga JOIN member_groups g ON g.id = mga.group_id
               WHERE mga.member_id = m.id
            ), '') AS group_name,
            m.consecutive_absences, u.name AS created_by_name
       FROM follow_ups f
       JOIN members m ON m.id = f.member_id
       LEFT JOIN users u ON u.id = f.created_by
       ${whereSql}
      ORDER BY CASE f.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
               f.created_at DESC`,
    params
  );
  res.json({ items: rows, total: rows.length });
}));

router.post('/', asyncHandler(async (req, res) => {
  const memberId = vInt(req.body, 'memberId', { required: true, label: 'Member' });
  const absentWeeks = vInt(req.body, 'absentWeeks', { min: 0 }) || 0;
  const lastSeen = vDate(req.body, 'lastSeen', { label: 'Last seen' });
  const reason = vStr(req.body, 'reason', { max: 300 });
  const priority = vEnum(req.body, 'priority', ['high', 'medium', 'low']) || 'medium';
  const assignedTo = vStr(req.body, 'assignedTo', { max: 120 });

  const member = await db.query('SELECT id FROM members WHERE id = $1', [memberId]);
  if (!member.rows.length) throw new ApiError(404, 'Member not found.');

  const { rows } = await db.query(
    `INSERT INTO follow_ups (member_id, absent_weeks, last_seen, reason, priority, assigned_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [memberId, absentWeeks, lastSeen, reason, priority, assignedTo, req.user.id]
  );
  res.status(201).json({ item: await findFollowUp(rows[0].id) });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await findFollowUp(id);
  if (!existing) throw new ApiError(404, 'Follow-up not found.');

  const absentWeeks = vInt(req.body, 'absentWeeks', { min: 0 });
  const lastSeen = vDate(req.body, 'lastSeen', {});
  const reason = vStr(req.body, 'reason', { max: 300 });
  const priority = vEnum(req.body, 'priority', ['high', 'medium', 'low']) || existing.priority;
  const assignedTo = vStr(req.body, 'assignedTo', { max: 120 });
  const status = vEnum(req.body, 'status', ['open', 'closed']) || existing.status;

  await db.query(
    `UPDATE follow_ups
        SET absent_weeks = $1, last_seen = $2, reason = $3, priority = $4, assigned_to = $5, status = $6
      WHERE id = $7`,
    [
      absentWeeks !== null ? absentWeeks : existing.absent_weeks,
      lastSeen !== null ? lastSeen : existing.last_seen,
      reason !== null ? reason : existing.reason,
      priority,
      assignedTo !== null ? assignedTo : existing.assigned_to,
      status,
      id,
    ]
  );
  res.json({ item: await findFollowUp(id) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM follow_ups WHERE id = $1', [Number(req.params.id)]);
  if (!rowCount) throw new ApiError(404, 'Follow-up not found.');
  res.status(204).end();
}));

module.exports = router;