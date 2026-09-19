const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vStr, vInt, vEnum, vDate } = require('../utils/validate');
const { authenticate, requireAdmin, assertLocalAccess } = require('../middleware/auth');

/** District & local admins bypass usher-specific restrictions. */
function isAdminUser(user) {
  return !!user && (user.role === 'district_admin' || user.role === 'local_admin');
}
const { recomputeMemberStats, getServiceTotals } = require('../services/stats');
const { getSettingsMap } = require('../services/settings');
const { syncFollowUpForMember } = require('../services/followups');

/** Recompute a member's streak then auto-add them to follow-ups if needed. */
async function recomputeMemberAndSync(db, memberId, userId) {
  await recomputeMemberStats(db, memberId);
  await syncFollowUpForMember(db, memberId, { createdBy: userId });
}

const router = express.Router();

async function serviceById(id) {
  const { rows } = await db.query(
    `SELECT s.id, s.service_date, s.service_name, s.start_time, s.total_headcount,
            s.attendance_closed, s.attendance_close_time, l.name AS location_name,
            s.local_id, b.name AS local_name, s.all_locals
       FROM services s
       LEFT JOIN locations l ON l.id = s.location_id
       LEFT JOIN locals b ON b.id = s.local_id
      WHERE s.id = $1`,
    [id]
  );
  return rows[0];
}

const CLOSED_MSG_MANUAL = 'Attendance for this service has been closed by an admin. Ask an admin to reopen it before making changes.';
const CLOSED_MSG_SCHEDULE = 'The attendance close time for this service has passed, so marking is locked. Ask an admin to extend or remove the close time.';

function isMarkingClosed(svc) {
  return !!svc && (
    svc.attendance_closed
    || (!!svc.attendance_close_time && new Date(svc.attendance_close_time).getTime() <= Date.now())
  );
}

/**
 * Local access for a service. Joint services (all_locals = TRUE, e.g. a
 * combined all-locals gathering) may be viewed and marked by staff of ANY
 * local; regular services keep the strict same-local rule.
 */
function checkServiceAccess(user, service) {
  if (!service.all_locals) assertLocalAccess(user, service.local_id);
}

function closedMessage(svc) {
  return svc && !svc.attendance_closed && svc.attendance_close_time ? CLOSED_MSG_SCHEDULE : CLOSED_MSG_MANUAL;
}

async function recordById(id) {
  const { rows } = await db.query(
    `SELECT a.*, m.full_name AS member_name, s.service_date, s.service_name,
            ru.name AS recorded_by_name, uu.name AS updated_by_name
       FROM attendance a
       JOIN members m ON m.id = a.member_id
       JOIN services s ON s.id = a.service_id
       LEFT JOIN users ru ON ru.id = a.recorded_by_user_id
       LEFT JOIN users uu ON uu.id = a.updated_by_user_id
      WHERE a.id = $1`,
    [id]
  );
  return rows[0];
}

/**
 * Roster for one service: every (optionally filtered) member plus their
 * existing attendance record. Powers both the admin and usher screens.
 */
router.get('/roster/:serviceId', authenticate, asyncHandler(async (req, res) => {
  const serviceId = Number(req.params.serviceId);
  const service = await serviceById(serviceId);
  if (!service) throw new ApiError(404, 'Service not found.');

  // Check local access
  checkServiceAccess(req.user, service);

  const search = vStr(req.query, 'search', { max: 100 }) || '';
  const groupId = vInt(req.query, 'groupId');
  const statusFilter = vEnum(req.query, 'status', ['all', 'unmarked', 'present', 'absent', 'excused']) || 'all';
  const memberStatus = vEnum(req.query, 'memberStatus', ['active', 'inactive', 'all']) || 'active';
  const page = Math.max(1, vInt(req.query, 'page') || 1);
  const pageSize = Math.min(200, Math.max(1, vInt(req.query, 'pageSize') || 50));

  // Build filtering in SQL so pagination stays correct even with many members.
  const where = ['true'];
  const params = [serviceId];
  const push = (v) => { params.push(v); return params.length; };
  if (search) where.push(`m.full_name ILIKE '%' || $${push(`%${search}%`)} || '%'`);
  if (groupId) where.push(`EXISTS (SELECT 1 FROM member_group_assignments mga WHERE mga.member_id = m.id AND mga.group_id = $${push(groupId)})`);
  if (memberStatus !== 'all') where.push(`m.status = $${push(memberStatus)}`);
  if (statusFilter === 'unmarked') where.push('a.id IS NULL');
  else if (statusFilter !== 'all') where.push(`a.status = $${push(statusFilter)}`);
  const whereSql = where.join(' AND ');

  // Base filters (without status) drive the totals the save-bar shows.
  const baseWhere = ['true'];
  const baseParams = [serviceId];
  const bpush = (v) => { baseParams.push(v); return baseParams.length; };
  if (search) baseWhere.push(`m.full_name ILIKE '%' || $${bpush(`%${search}%`)} || '%'`);
  if (groupId) baseWhere.push(`EXISTS (SELECT 1 FROM member_group_assignments mga WHERE mga.member_id = m.id AND mga.group_id = $${bpush(groupId)})`);
  if (memberStatus !== 'all') baseWhere.push(`m.status = $${bpush(memberStatus)}`);
  const baseWhereSql = baseWhere.join(' AND ');

  const { rows } = await db.query({
    text: `SELECT m.id AS member_id, m.full_name, m.phone, m.email, m.status AS member_status,
                  COALESCE((
                    SELECT string_agg(g.name, ', ' ORDER BY g.name)
                      FROM member_group_assignments mga JOIN member_groups g ON g.id = mga.group_id
                     WHERE mga.member_id = m.id
                  ), '') AS group_name,
                  a.id AS attendance_id, a.status, a.notes, a.recorded_at, a.updated_at,
                  COALESCE(uu.name, ru.name) AS recorded_by_name
             FROM members m
             LEFT JOIN attendance a ON a.member_id = m.id AND a.service_id = $1
             LEFT JOIN users ru ON ru.id = a.recorded_by_user_id
             LEFT JOIN users uu ON uu.id = a.updated_by_user_id
            WHERE ${whereSql}
            ORDER BY m.full_name ASC
            LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    values: params,
  });

  const { rows: cnt } = await db.query({
    text: `SELECT COUNT(*) AS n
             FROM members m
             LEFT JOIN attendance a ON a.member_id = m.id AND a.service_id = $1
            WHERE ${whereSql}`,
    values: params,
  });

  // Totals across the base member pool (search/group/memberStatus, ignoring status filter).
  const { rows: baseCnt } = await db.query({
    text: `SELECT COUNT(*) AS total,
                  COUNT(a.id) FILTER (WHERE a.id IS NOT NULL) AS marked,
                  COUNT(a.id) FILTER (WHERE a.status = 'present') AS present
             FROM members m
             LEFT JOIN attendance a ON a.member_id = m.id AND a.service_id = $1
            WHERE ${baseWhereSql}`,
    values: baseParams,
  });

  let outRows = rows;

  // Ushers only see contact details when the admin allows it.
  if (!isAdminUser(req.user)) {
    const settings = await getSettingsMap(db);
    if (settings.show_member_contacts_to_ushers !== 'true') {
      outRows = outRows.map((r) => ({ ...r, phone: null, email: null }));
    }
  }

  const markedRow = baseCnt[0];
  const total = Number(markedRow.total);
  const lastUpdated = rows.reduce(
    (acc, r) => (r.updated_at && (!acc || new Date(r.updated_at) > new Date(acc)) ? r.updated_at : acc),
    null
  );

  res.json({
    service: {
    ...service,
    marking_closed: isMarkingClosed(service),
    all_locals: !!service.all_locals,
    // For a joint (all-locals) service the eligible pool is every active
    // member of every local; otherwise it is the service's local only.
    totals: await getServiceTotals(db, serviceId, service.all_locals ? null : service.local_id),
  },
    rows: outRows,
    markedCount: Number(markedRow.marked),
    presentCount: Number(markedRow.present),
    totalEligible: total,
    page,
    pageSize,
    total,
    lastUpdated,
  });
}));

/** Recent records submitted by the signed-in user â€” powers the usher "My marks" screen. */
router.get('/mine', authenticate, asyncHandler(async (req, res) => {
  const settings = await getSettingsMap(db);
  const canCorrectSetting = settings.usher_can_correct_attendance === 'true';
  const windowMin = Number(settings.usher_correction_window_minutes || 30);
  const cutoff = Date.now() - windowMin * 60 * 1000;
  const { rows } = await db.query({
    text: `SELECT a.id, a.status, a.recorded_at, a.updated_at,
                  m.id AS member_id, m.full_name AS member_name,
                  s.id AS service_id, s.service_name, s.service_date,
                  (s.attendance_closed OR (s.attendance_close_time IS NOT NULL AND s.attendance_close_time <= now())) AS marking_locked
             FROM attendance a
             JOIN members m ON m.id = a.member_id
             JOIN services s ON s.id = a.service_id
            WHERE a.recorded_by_user_id = $1
            ORDER BY s.service_date DESC, a.id DESC
            LIMIT 50`,
    values: [req.user.id],
  });
  const items = rows.map((r) => ({
    ...r,
    marking_locked: !!r.marking_locked,
    can_correct:
      isAdminUser(req.user) ||
      (canCorrectSetting && !r.marking_locked && new Date(r.recorded_at).getTime() >= cutoff),
  }));
  res.json({
    items,
    correction: {
      allowed: isAdminUser(req.user) || canCorrectSetting,
      selfOnly: !isAdminUser(req.user),
      windowMinutes: windowMin,
    },
  });
}));

/** Mark one member for one service. Upsert => never duplicates. */
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const serviceId = vInt(req.body, 'serviceId', { required: true, label: 'Service' });
  const memberId = vInt(req.body, 'memberId', { required: true, label: 'Member' });
  const status = vEnum(req.body, 'status', ['present', 'absent', 'excused'], { required: true });
  const notes = vStr(req.body, 'notes', { max: 500 });

  const service = await serviceById(serviceId);
  if (!service) throw new ApiError(404, 'Service not found.');
  // Only staff of the service's local may mark attendance for it.
  checkServiceAccess(req.user, service);
  if (isMarkingClosed(service)) throw new ApiError(403, closedMessage(service));

  const { rows: memberRows } = await db.query('SELECT id, status, local_id FROM members WHERE id = $1', [memberId]);
  const member = memberRows[0];
  if (!member) throw new ApiError(404, 'Member not found.');
  // Members belong to a local; they can only be marked for that local's
  // services â€” except at a joint (all-locals) service, where everyone gathers.
  if (!service.all_locals && member.local_id !== service.local_id) {
    throw new ApiError(400, 'This member belongs to a different local than this service.');
  }
  if (member.status !== 'active') {
    const existing = await db.query(
      'SELECT id FROM attendance WHERE member_id = $1 AND service_id = $2',
      [memberId, serviceId]
    );
    if (!existing.rows.length) {
      throw new ApiError(400, 'This member is inactive and cannot be marked for attendance.');
    }
  }

  const { rows } = await db.query(
    `INSERT INTO attendance (member_id, service_id, status, notes, recorded_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (member_id, service_id) DO UPDATE
        SET status = EXCLUDED.status,
            notes = EXCLUDED.notes,
            updated_by_user_id = EXCLUDED.recorded_by_user_id,
            updated_at = now()
     RETURNING *`,
    [memberId, serviceId, status, notes, req.user.id]
  );
  await recomputeMemberAndSync(db, memberId, req.user.id);
  res.status(201).json({ item: await recordById(rows[0].id) });
}));

/** Correct an existing record. Admins always; ushers only per settings. */
router.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await db.query('SELECT * FROM attendance WHERE id = $1', [id]);
  const record = rows[0];
  if (!record) throw new ApiError(404, 'Attendance record not found.');

  const svc = await serviceById(record.service_id);
  checkServiceAccess(req.user, svc);
  if (isMarkingClosed(svc)) throw new ApiError(403, closedMessage(svc));

  if (!isAdminUser(req.user)) {
    const settings = await getSettingsMap(db);
    if (settings.usher_can_correct_attendance !== 'true') {
      throw new ApiError(403, 'Ushers are not currently allowed to correct attendance records.');
    }
    if (record.recorded_by_user_id !== req.user.id) {
      throw new ApiError(403, 'You can only correct records you saved yourself.');
    }
    const windowMinutes = Number(settings.usher_correction_window_minutes || 30);
    const elapsedMs = Date.now() - new Date(record.recorded_at).getTime();
    if (elapsedMs > windowMinutes * 60 * 1000) {
      throw new ApiError(403, `Records can only be corrected within ${windowMinutes} minutes of being saved.`);
    }
  }

  const status = vEnum(req.body, 'status', ['present', 'absent', 'excused']) || record.status;
  let notes = record.notes;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'notes')) {
    notes = vStr(req.body, 'notes', { max: 500 });
  }

  await db.query(
    'UPDATE attendance SET status = $1, notes = $2, updated_by_user_id = $3 WHERE id = $4',
    [status, notes, req.user.id, id]
  );
  await recomputeMemberAndSync(db, record.member_id, req.user.id);
  res.json({ item: await recordById(id) });
}));

/**
 * Quick mark by member code (PIN flow). The usher types the member's code at
 * the door; the member is marked for this service (present by default).
 * Local access checks apply exactly like manual marking.
 */
router.post('/code', authenticate, asyncHandler(async (req, res) => {
  const serviceId = vInt(req.body, 'serviceId', { required: true, label: 'Service' });
  const code = String(vStr(req.body, 'code', { required: true, max: 4, label: 'PIN' }) || '').trim();
  if (!/^\d{4}$/.test(code)) {
    throw new ApiError(400, 'Enter the 4-digit member PIN.', [
      { field: 'code', message: 'Must be exactly 4 digits.' },
    ]);
  }
  const status = vEnum(req.body, 'status', ['present', 'absent', 'excused']) || 'present';
  const notes = vStr(req.body, 'notes', { max: 500 });

  const service = await serviceById(serviceId);
  if (!service) throw new ApiError(404, 'Service not found.');
  checkServiceAccess(req.user, service);
  if (isMarkingClosed(service)) throw new ApiError(403, closedMessage(service));

  const { rows: memberRows } = await db.query(
    'SELECT id, status, local_id, full_name FROM members WHERE member_code = $1',
    [code]
  );
  const member = memberRows[0];
  if (!member) throw new ApiError(404, 'No member matches that code.');
  if (!service.all_locals && member.local_id !== service.local_id) {
    throw new ApiError(400, 'This member belongs to a different local than this service.');
  }
  if (member.status !== 'active') {
    throw new ApiError(400, `${member.full_name} is inactive and cannot be marked.`);
  }

  const upsert = await db.query(
    `INSERT INTO attendance (member_id, service_id, status, notes, recorded_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (member_id, service_id)
     DO UPDATE SET status = $3, notes = $4, updated_by_user_id = $5, updated_at = now()
     RETURNING id`,
    [member.id, serviceId, status, notes, req.user.id]
  );
  await recomputeMemberAndSync(db, member.id, req.user.id);
  res.status(201).json({ item: await recordById(upsert.rows[0].id) });
}));

/** Full attendance log (admin) with filters. */
router.get('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const serviceId = vInt(req.query, 'serviceId');
  const memberId = vInt(req.query, 'memberId');
  const recordedByUserId = vInt(req.query, 'recordedByUserId');
  const status = vEnum(req.query, 'status', ['all', 'present', 'absent', 'excused']) || 'all';
  const from = vDate(req.query, 'from');
  const to = vDate(req.query, 'to');
  const page = Math.max(1, vInt(req.query, 'page') || 1);
  const pageSize = Math.min(2000, Math.max(1, vInt(req.query, 'pageSize') || 25));

  const where = [];
  const params = [];
  // Local admins only see records for their own local's services.
  // Joint (local-less) services are visible to every admin; scoping is by
  // service local, not by which member was marked.
  if (req.user.role !== 'district_admin') {
    params.push(req.user.local_id || -1);
    where.push(`(s.local_id = $${params.length} OR s.all_locals = TRUE)`);
  }
  if (serviceId) { params.push(serviceId); where.push(`a.service_id = $${params.length}`); }
  if (memberId) { params.push(memberId); where.push(`a.member_id = $${params.length}`); }
  if (recordedByUserId) { params.push(recordedByUserId); where.push(`(a.recorded_by_user_id = $${params.length} OR a.updated_by_user_id = $${params.length})`); }
  if (status !== 'all') { params.push(status); where.push(`a.status = $${params.length}`); }
  if (from) { params.push(from); where.push(`s.service_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`s.service_date <= $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT a.id, a.status, a.notes, a.recorded_at, a.updated_at,
            a.member_id, a.service_id,
            m.full_name AS member_name,
            COALESCE((
              SELECT string_agg(g.name, ', ' ORDER BY g.name)
                FROM member_group_assignments mga JOIN member_groups g ON g.id = mga.group_id
               WHERE mga.member_id = m.id
            ), '') AS group_name,
            s.service_date, s.service_name,
            ru.name AS recorded_by_name, uu.name AS updated_by_name
       FROM attendance a
       JOIN members m ON m.id = a.member_id
       JOIN services s ON s.id = a.service_id
       LEFT JOIN users ru ON ru.id = a.recorded_by_user_id
       LEFT JOIN users uu ON uu.id = a.updated_by_user_id
       ${whereSql}
      ORDER BY a.recorded_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params
  );
  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) AS n
       FROM attendance a
       JOIN services s ON s.id = a.service_id
       ${whereSql}`,
    params
  );
  res.json({ items: rows, total: Number(countRows[0].n), page, pageSize });
}));

router.get('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const record = await recordById(Number(req.params.id));
  if (!record) throw new ApiError(404, 'Attendance record not found.');
  res.json({ item: record });
}));

router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await db.query('SELECT member_id, service_id FROM attendance WHERE id = $1', [id]);
  if (!rows.length) throw new ApiError(404, 'Attendance record not found.');
  const svc = await serviceById(rows[0].service_id);
  checkServiceAccess(req.user, svc);
  if (isMarkingClosed(svc)) throw new ApiError(403, closedMessage(svc));
  await db.query('DELETE FROM attendance WHERE id = $1 RETURNING member_id', [id]);
  await recomputeMemberAndSync(db, rows[0].member_id, req.user.id);
  res.status(204).end();
}));

module.exports = router;


