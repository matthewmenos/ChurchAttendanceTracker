const db = require('../config/db');
const { ApiError } = require('../utils/errors');
const { getSettingsMap } = require('./settings');
const { isArkaselConfigured, sendViaArkasel, renderTemplate } = require('./sms');

async function findVisitor(id) {
  const { rows } = await db.query(
    `SELECT v.*, s.service_name AS service_name, s.service_date AS service_date, u.name AS created_by_name
       FROM visitors v
       LEFT JOIN services s ON s.id = v.service_id
       LEFT JOIN users u ON u.id = v.created_by
      WHERE v.id = $1`,
    [id]
  );
  return rows[0];
}

async function sendThankYou(fullName, phone) {
  const settings = await getSettingsMap(db);
  if (settings.visitor_thanks_enabled !== 'true') return 'thanks-disabled';
  if (!isArkaselConfigured()) return 'dry-run';
  if (!phone) return 'no-phone';
  const message = renderTemplate(settings.visitor_thanks_template || '', {
    full_name: fullName,
    church_name: settings.church_name || '',
  });
  try {
    const r = await sendViaArkasel(phone, message);
    return r.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Create (or register a return visit for) a visitor. */
async function createVisitor({ fullName, gender, phone, email, ageGroup, homeArea, invitedBy, prayerRequest, serviceId, createdBy, notes }) {
  let existing = null;
  if (phone) {
    const { rows } = await db.query('SELECT id FROM visitors WHERE phone = $1 ORDER BY id DESC LIMIT 1', [phone]);
    existing = rows[0] || null;
  }

  if (existing) {
    await db.query(
      `UPDATE visitors SET visit_count = visit_count + 1, last_visit_date = CURRENT_DATE, updated_at = now() WHERE id = $1`,
      [existing.id]
    );
    await recordVisit(existing.id, serviceId, createdBy);
    return { visitor: await findVisitor(existing.id), returning: true, thanksStatus: 'returning-message-skipped' };
  }

  const { rows } = await db.query(
    `INSERT INTO visitors
       (full_name, gender, phone, email, age_group, home_area, invited_by, prayer_request,
        service_id, first_visit_date, visit_count, last_visit_date, created_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, 1, CURRENT_DATE, $10, $11)
     RETURNING id`,
    [fullName, gender, phone || null, email || null, ageGroup || null, homeArea || null, invitedBy || null, prayerRequest || null, serviceId || null, createdBy || null, notes || null]
  );
  const vid = rows[0].id;
  await recordVisit(vid, serviceId, createdBy);
  const thanksStatus = await sendThankYou(fullName, phone);
  return { visitor: await findVisitor(vid), returning: false, thanksStatus };
}

async function recordVisit(visitorId, serviceId, recordedBy) {
  if (!serviceId) return;
  await db.query(
    `INSERT INTO visitor_visits (visitor_id, service_id, visit_date, recorded_by)
     VALUES ($1, $2, CURRENT_DATE, $3)
     ON CONFLICT DO NOTHING`,
    [visitorId, serviceId, recordedBy]
  );
}

async function listVisitors({ serviceId, followupStatus, search, page = 1, pageSize = 20 }) {
  const where = [];
  const params = [];
  if (serviceId) { params.push(serviceId); where.push(`v.service_id = $${params.length}`); }
  if (followupStatus) { params.push(followupStatus); where.push(`v.followup_status = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    where.push(`(v.full_name ILIKE $${n} OR COALESCE(v.phone, '') ILIKE $${n})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  page = Math.max(1, page);
  pageSize = Math.min(200, Math.max(1, pageSize));
  const { rows } = await db.query(
    `SELECT v.*, s.service_name, s.service_date, u.name AS created_by_name
       FROM visitors v
       LEFT JOIN services s ON s.id = v.service_id
       LEFT JOIN users u ON u.id = v.created_by
       ${whereSql}
      ORDER BY v.created_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params
  );
  const { rows: c } = await db.query(`SELECT COUNT(*) AS n FROM visitors v ${whereSql}`, params);
  return { items: rows, total: Number(c[0].n), page, pageSize };
}

async function updateVisitor(id, fields) {
  const existing = await findVisitor(id);
  if (!existing) throw new ApiError(404, 'Visitor not found.');
  const sets = [];
  const params = [];
  const push = (key, value) => { params.push(value); sets.push(`${key} = $${params.length}`); };
  const nonNull = (x) => (x === undefined ? undefined : (x || null));
  if (fields.gender !== undefined) push('gender', nonNull(fields.gender));
  if (fields.email !== undefined) push('email', nonNull(fields.email));
  if (fields.phone !== undefined) push('phone', nonNull(fields.phone));
  if (fields.ageGroup !== undefined) push('age_group', nonNull(fields.ageGroup));
  if (fields.homeArea !== undefined) push('home_area', nonNull(fields.homeArea));
  if (fields.invitedBy !== undefined) push('invited_by', nonNull(fields.invitedBy));
  if (fields.prayerRequest !== undefined) push('prayer_request', nonNull(fields.prayerRequest));
  if (fields.followupStatus !== undefined) push('followup_status', nonNull(fields.followupStatus));
  if (fields.assignedTo !== undefined) push('assigned_to', nonNull(fields.assignedTo));
  if (fields.notes !== undefined) push('notes', nonNull(fields.notes));
  sets.push('updated_at = now()');
  params.push(id);
  const whereIdx = params.length;
  await db.query(
    `UPDATE visitors SET ${sets.join(', ')} WHERE id = $${whereIdx}`,
    params
  );
  return findVisitor(id);
}

async function convertToMember(visitorId) {
  const v = await findVisitor(visitorId);
  if (!v) throw new ApiError(404, 'Visitor not found.');
  if (v.converted_member_id) return { visitor: v, member_id: v.converted_member_id, alreadyConverted: true };
  const { rows } = await db.query(
    `INSERT INTO members (full_name, phone, email, gender, status, notes)
     VALUES ($1, $2, $3, $4, 'active', $5)
     RETURNING id`,
    [v.full_name, v.phone || null, v.email || null, v.gender || null, v.notes || null]
  );
  const memberId = rows[0].id;
  await db.query(
    `UPDATE visitors SET converted_member_id = $1, followup_status = 'joined', updated_at = now() WHERE id = $2`,
    [memberId, visitorId]
  );
  return { visitor: await findVisitor(visitorId), member_id: memberId, alreadyConverted: false };
}

async function visitorStats({ from, to } = {}) {
  const where = [];
  const params = [];
  if (from) { params.push(from); where.push(`s.service_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`s.service_date <= $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT s.id, s.service_name, s.service_date,
            COUNT(v.id) AS total_visitors,
            COUNT(v.id) FILTER (WHERE v.visit_count = 1) AS first_time,
            COUNT(v.id) FILTER (WHERE v.visit_count > 1) AS returning,
            COUNT(v.id) FILTER (WHERE v.gender = 'male')   AS male,
            COUNT(v.id) FILTER (WHERE v.gender = 'female') AS female,
            COUNT(v.id) FILTER (WHERE v.converted_member_id IS NOT NULL) AS converted
       FROM services s
       LEFT JOIN visitors v ON v.service_id = s.id
       ${whereSql}
      GROUP BY s.id, s.service_name, s.service_date
      ORDER BY s.service_date DESC`,
    params
  );
  return rows;
}

module.exports = { findVisitor, createVisitor, listVisitors, updateVisitor, convertToMember, visitorStats };