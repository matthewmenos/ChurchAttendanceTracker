const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vStr, vInt, vDate, vTime } = require('../utils/validate');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getServiceTotals } = require('../services/stats');

const router = express.Router();

const LIST_SELECT = `
  SELECT s.id, s.service_date, s.service_name, s.start_time, s.total_headcount, s.notes,
         s.location_id, l.name AS location_name, s.created_at, s.updated_at,
         s.attendance_closed, s.attendance_closed_at, cb.name AS attendance_closed_by_name,
         COALESCE(a.present, 0)::int AS present,
         COALESCE(a.absent, 0)::int  AS absent,
         COALESCE(a.excused, 0)::int AS excused,
         COALESCE(a.marked, 0)::int  AS marked
    FROM services s
    LEFT JOIN locations l ON l.id = s.location_id
    LEFT JOIN users cb ON cb.id = s.attendance_closed_by
    LEFT JOIN (
      SELECT service_id,
             COUNT(*) FILTER (WHERE status = 'present') AS present,
             COUNT(*) FILTER (WHERE status = 'absent')  AS absent,
             COUNT(*) FILTER (WHERE status = 'excused') AS excused,
             COUNT(*) AS marked
        FROM attendance
      GROUP BY service_id
    ) a ON a.service_id = s.id`;

async function checkLocation(locationId) {
  if (locationId == null) return null;
  const { rows } = await db.query('SELECT id FROM locations WHERE id = $1', [locationId]);
  if (!rows.length) {
    throw new ApiError(400, 'The selected location does not exist.', [
      { field: 'locationId', message: 'Unknown location.' },
    ]);
  }
  return locationId;
}

async function serviceById(id) {
  const { rows } = await db.query(`${LIST_SELECT} WHERE s.id = $1`, [id]);
  return rows[0];
}

function withFlags(row) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return { ...row, upcoming: String(row.service_date) >= todayStr };
}

// Ushers need the service list to pick the current service.
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const search = vStr(req.query, 'search', { max: 100 }) || '';
  const from = vDate(req.query, 'from');
  const to = vDate(req.query, 'to');
  const page = Math.max(1, vInt(req.query, 'page') || 1);
  const pageSize = Math.min(200, Math.max(1, vInt(req.query, 'pageSize') || 50));

  const where = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`s.service_name ILIKE $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`s.service_date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`s.service_date <= $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await db.query(
    `${LIST_SELECT} ${whereSql} ORDER BY s.service_date DESC, s.start_time DESC NULLS LAST LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params
  );
  const { rows: countRows } = await db.query(`SELECT COUNT(*) AS n FROM services s ${whereSql}`, params);
  res.json({ items: rows.map(withFlags), total: Number(countRows[0].n), page, pageSize });
}));

router.post('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const serviceDate = vDate(req.body, 'serviceDate', { required: true, label: 'Service date' });
  const serviceName = vStr(req.body, 'serviceName', { required: true, max: 120, label: 'Service name' });
  const startTime = vTime(req.body, 'startTime', { label: 'Start time' });
  const locationId = await checkLocation(vInt(req.body, 'locationId'));
  const headcount = vInt(req.body, 'totalHeadcount', { min: 0, label: 'Total headcount' }) || 0;
  const notes = vStr(req.body, 'notes', { max: 500 });

  const { rows } = await db.query(
    `INSERT INTO services (service_date, service_name, start_time, location_id, total_headcount, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [serviceDate, serviceName, startTime, locationId, headcount, notes, req.user.id]
  );
  res.status(201).json({ service: withFlags(await serviceById(rows[0].id)) });
}));

router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const service = await serviceById(Number(req.params.id));
  if (!service) throw new ApiError(404, 'Service not found.');
  res.json({ service: withFlags(service) });
}));

/** Close attendance marking for this service (admin only). */
router.post('/:id/close', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const service = await serviceById(id);
  if (!service) throw new ApiError(404, 'Service not found.');
  await db.query(
    'UPDATE services SET attendance_closed = TRUE, attendance_closed_at = now(), attendance_closed_by = $1 WHERE id = $2',
    [req.user.id, id]
  );
  res.json({ service: withFlags(await serviceById(id)) });
}));

/** Reopen attendance marking for this service (admin only). */
router.post('/:id/reopen', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const service = await serviceById(id);
  if (!service) throw new ApiError(404, 'Service not found.');
  await db.query(
    'UPDATE services SET attendance_closed = FALSE, attendance_closed_at = NULL, attendance_closed_by = NULL WHERE id = $1',
    [id]
  );
  res.json({ service: withFlags(await serviceById(id)) });
}));

router.put('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await serviceById(id);
  if (!existing) throw new ApiError(404, 'Service not found.');

  const serviceDate = vDate(req.body, 'serviceDate', { required: true, label: 'Service date' });
  const serviceName = vStr(req.body, 'serviceName', { required: true, max: 120, label: 'Service name' });
  const startTime = vTime(req.body, 'startTime', { label: 'Start time' });
  const locationId = await checkLocation(vInt(req.body, 'locationId'));
  const headcount = vInt(req.body, 'totalHeadcount', { min: 0, label: 'Total headcount' }) || 0;
  const notes = vStr(req.body, 'notes', { max: 500 });

  await db.query(
    `UPDATE services
        SET service_date = $1, service_name = $2, start_time = $3,
            location_id = $4, total_headcount = $5, notes = $6
      WHERE id = $7`,
    [serviceDate, serviceName, startTime, locationId, headcount, notes, id]
  );
  res.json({ service: withFlags(await serviceById(id)) });
}));

router.get('/:id/attendance', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const service = await serviceById(id);
  if (!service) throw new ApiError(404, 'Service not found.');

  const { rows } = await db.query(
    `SELECT a.id, a.status, a.notes, a.recorded_at, a.updated_at,
            a.member_id, m.full_name AS member_name, m.gender,
            COALESCE((
              SELECT string_agg(g.name, ', ' ORDER BY g.name)
                FROM member_group_assignments mga JOIN member_groups g ON g.id = mga.group_id
               WHERE mga.member_id = m.id
            ), '') AS group_name,
            ru.name AS recorded_by_name, uu.name AS updated_by_name
       FROM attendance a
       JOIN members m ON m.id = a.member_id
       LEFT JOIN users ru ON ru.id = a.recorded_by_user_id
       LEFT JOIN users uu ON uu.id = a.updated_by_user_id
      WHERE a.service_id = $1
      ORDER BY m.full_name ASC`,
    [id]
  );
  res.json({ service: withFlags(service), totals: await getServiceTotals(db, id), items: rows });
}));

module.exports = router;