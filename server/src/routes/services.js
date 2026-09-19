const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vStr, vInt, vDate, vTime } = require('../utils/validate');
const { authenticate, requireAdmin, getLocalFilter, assertLocalAccess } = require('../middleware/auth');
const { getServiceTotals } = require('../services/stats');
const { syncFollowUps } = require('../services/followups');

const router = express.Router();

const LIST_SELECT = `
  SELECT s.id, s.service_date, s.service_name, s.start_time, s.total_headcount, s.notes,
         s.location_id, l.name AS location_name, s.local_id, b.name AS local_name, s.created_at, s.updated_at,
         s.all_locals,
         s.attendance_closed, s.attendance_closed_at, cb.name AS attendance_closed_by_name,
         s.attendance_close_time,
         s.visitor_headcount,
         COALESCE(a.present, 0)::int AS present,
         COALESCE(a.absent, 0)::int  AS absent,
         COALESCE(a.excused, 0)::int AS excused,
         COALESCE(a.marked, 0)::int  AS marked,
         (COALESCE(a.present, 0) + COALESCE(s.visitor_headcount, 0))::int AS total_present
    FROM services s
    LEFT JOIN locations l ON l.id = s.location_id
    LEFT JOIN locals b ON b.id = s.local_id
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
  const schedulePassed = !!row.attendance_close_time
    && new Date(row.attendance_close_time).getTime() <= Date.now();
  const visitorHeadcount = Number(row.visitor_headcount) || 0;
  const presentMembers = Number(row.present) || 0;
  return {
    ...row,
    visitor_headcount: visitorHeadcount,
    total_present: presentMembers + visitorHeadcount,
    all_locals: !!row.all_locals,
    upcoming: String(row.service_date) >= todayStr,
    marking_closed: !!row.attendance_closed || schedulePassed,
  };
}

/**
 * Local access for a service. Joint services (all_locals = TRUE, e.g. a
 * combined all-locals gathering) can be viewed and marked by staff of ANY
 * local; regular services keep the strict same-local rule.
 */
function checkServiceAccess(user, service) {
  if (!service.all_locals) assertLocalAccess(user, service.local_id);
}

/** Only the district admin may flag a service as a joint all-locals service. */
function readAllLocals(user, body) {
  const wanted = !!body && ['1', 'true'].includes(String(body.allLocals).toLowerCase());
  if (!wanted) return false;
  if (user.role !== 'district_admin') {
    throw new ApiError(403, 'Only the main admin can create an all-locals service.');
  }
  return true;
}

/**
 * Visitor headcount is a manual count of walk-in visitors entered by an
 * admin/usher; total headcount = members marked present + visitors.
 * Total headcount itself stays read-only: it always mirrors the computed
 * number of members marked present plus the visitor count, so nobody can
 * type (or sneak in) a stale value.
 * Rejects any client-supplied totalHeadcount instead of ignoring it, so a
 * cached old form fails loudly instead of pretending its number was saved.
 */
/** Validate the manual visitor headcount (optional, >= 0). */
function readVisitorHeadcount(body) {
  const raw = body ? body.visitorHeadcount : undefined;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new ApiError(400, 'Visitor headcount must be a whole number of 0 or more.', [
      { field: 'visitorHeadcount', message: 'Enter 0 or more.' },
    ]);
  }
  return n;
}

function rejectClientHeadcount(body) {
  if (body && body.totalHeadcount !== undefined && body.totalHeadcount !== null && String(body.totalHeadcount).trim() !== '') {
    throw new ApiError(400, 'Total headcount is computed automatically from attendance and cannot be set manually.', [
      { field: 'totalHeadcount', message: 'Read-only: shows members marked present.' },
    ]);
  }
}

/** Validate an optional 'YYYY-MM-DDTHH:MM[:SS]' close time from the client. */
function readCloseTime(body) {
  const raw = body ? body.attendanceCloseTime : undefined;
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(raw.trim())) {
    throw new ApiError(400, 'The attendance close time is not a valid date/time.', [
      { field: 'attendanceCloseTime', message: 'Use a valid date and time.' },
    ]);
  }
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) {
    throw new ApiError(400, 'The attendance close time is not a valid date/time.');
  }
  return d.toISOString();
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
  
  // Local filtering â€” but joint (all-locals) services are visible to everyone.
  const localId = getLocalFilter(req);
  if (localId) {
    params.push(localId);
    where.push(`(s.local_id = $${params.length} OR s.all_locals = TRUE)`);
  }
  
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
  rejectClientHeadcount(req.body);
  const visitorHeadcount = readVisitorHeadcount(req.body) || 0;
  const notes = vStr(req.body, 'notes', { max: 500 });
  const closeTime = readCloseTime(req.body);
  const allLocals = readAllLocals(req.user, req.body);

  // Joint services (all locals gather) belong to no specific local.
  // Regular services belong to the creator's local, or the local a
  // district admin explicitly picks.
  let localId = req.user.role === 'district_admin' ? null : req.user.local_id;
  if (!allLocals) {
    if (req.user.role === 'district_admin' && req.body.localId) {
      localId = Number(req.body.localId);
    }
    if (!localId) {
      throw new ApiError(400, 'Every service belongs to a local. Pick a local, or tick the all-locals box for a joint service.', [
        { field: 'localId', message: 'Local is required.' },
      ]);
    }
  }
  if (localId) {
    const { rows: localRows } = await db.query(
      `SELECT id FROM locals WHERE id = $1 AND status = 'active'`, [localId]);
    if (!localRows.length) {
      throw new ApiError(400, 'Invalid or inactive local.', [
        { field: 'localId', message: 'Unknown local.' },
      ]);
    }
  }

  const { rows } = await db.query(
    `INSERT INTO services (service_date, service_name, start_time, location_id, total_headcount, visitor_headcount, notes, created_by, attendance_close_time, local_id, all_locals)
     VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [serviceDate, serviceName, startTime, locationId, visitorHeadcount, notes, req.user.id, closeTime, localId, allLocals]
  );
  res.status(201).json({ service: withFlags(await serviceById(rows[0].id)) });
}));

router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const service = await serviceById(Number(req.params.id));
  if (!service) throw new ApiError(404, 'Service not found.');
  checkServiceAccess(req.user, service);
  res.json({ service: withFlags(service) });
}));

/** Close attendance marking for this service (admin only). */
router.post('/:id/close', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const service = await serviceById(id);
  if (!service) throw new ApiError(404, 'Service not found.');
  checkServiceAccess(req.user, service);
  await db.query(
    'UPDATE services SET attendance_closed = TRUE, attendance_closed_at = now(), attendance_closed_by = $1 WHERE id = $2',
    [req.user.id, id]
  );
  // Finalise absences: auto-add members whose streak crossed the threshold.
  await syncFollowUps(db, { createdBy: req.user.id });
  res.json({ service: withFlags(await serviceById(id)) });
}));

/** Reopen attendance marking for this service (admin only). */
/** Reopen attendance marking for this service (admin only).
 *  Also clears any scheduled close time so the service stays open. */
router.post('/:id/reopen', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const service = await serviceById(id);
  if (!service) throw new ApiError(404, 'Service not found.');
  checkServiceAccess(req.user, service);
  await db.query(
    'UPDATE services SET attendance_closed = FALSE, attendance_closed_at = NULL, attendance_closed_by = NULL, attendance_close_time = NULL WHERE id = $1',
    [id]
  );
  res.json({ service: withFlags(await serviceById(id)) });
}));

router.put('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await serviceById(id);
  if (!existing) throw new ApiError(404, 'Service not found.');
  checkServiceAccess(req.user, existing);

  const serviceDate = vDate(req.body, 'serviceDate', { required: true, label: 'Service date' });
  const serviceName = vStr(req.body, 'serviceName', { required: true, max: 120, label: 'Service name' });
  const startTime = vTime(req.body, 'startTime', { label: 'Start time' });
  const locationId = await checkLocation(vInt(req.body, 'locationId'));
  rejectClientHeadcount(req.body);
  const visitorHeadcount = readVisitorHeadcount(req.body);
  const notes = vStr(req.body, 'notes', { max: 500 });
  const closeTime = readCloseTime(req.body);
  const allLocals = readAllLocals(req.user, req.body) || (existing.all_locals && req.body.allLocals === undefined);

  // Joint services belong to no specific local; toggling a service to
  // joint clears its local, toggling back requires picking one.
  // District admins may also move a regular service to another local
  // (localId omitted = keep current; empty/null = clear to joint-ready).
  let localId = existing.local_id;
  if (req.user.role === 'district_admin' && req.body.localId !== undefined) {
    const raw = req.body.localId;
    if (raw === null || raw === '') {
      localId = null;
    } else {
      const next = vInt(req.body, 'localId');
      if (next) {
        const { rows: localRows } = await db.query(
          `SELECT id FROM locals WHERE id = $1 AND status = 'active'`, [next]);
        if (!localRows.length) {
          throw new ApiError(400, 'Invalid or inactive local.', [
            { field: 'localId', message: 'Unknown local.' },
          ]);
        }
        localId = next;
      }
    }
  }
  if (allLocals) {
    localId = null;
  } else if (!localId) {
    throw new ApiError(400, 'Every service belongs to a local. Pick a local, or tick the all-locals box for a joint service.', [
      { field: 'localId', message: 'Local is required.' },
    ]);
  }

  await db.query(
    `UPDATE services
        SET service_date = $1, service_name = $2, start_time = $3,
            location_id = $4, notes = $5, attendance_close_time = $6,
            local_id = $7, all_locals = $8,
            visitor_headcount = COALESCE($9, visitor_headcount)
      WHERE id = $10`,
    [serviceDate, serviceName, startTime, locationId, notes, closeTime, localId, allLocals,
     visitorHeadcount === undefined ? null : visitorHeadcount, id]
  );
  res.json({ service: withFlags(await serviceById(id)) });
}));

router.get('/:id/attendance', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const service = await serviceById(id);
  if (!service) throw new ApiError(404, 'Service not found.');
  checkServiceAccess(req.user, service);

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
  res.json({ service: withFlags(service), totals: await getServiceTotals(db, id, service.all_locals ? null : service.local_id), items: rows });
}));

module.exports = router;

