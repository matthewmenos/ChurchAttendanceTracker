'use strict';

/**
 * Reporting queries shared by the JSON report endpoints and the Excel export.
 *
 * Keeping the SQL here (rather than in the route) means the workbook an admin
 * downloads is produced from exactly the numbers shown on screen.
 */

const { vDate } = require('../utils/validate');

const RANGE_DAYS = 90;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Default report window: the last 90 days, ending today. */
function defaultRange(query = {}) {
  const to = vDate(query, 'to') || todayStr();
  const from = vDate(query, 'from') || new Date(Date.now() - RANGE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * Local scoping for report queries.
 * District admins see all locals (narrow with ?localId=); every other
 * admin is hard-scoped to their own local (-1 matches nothing).
 */
function localScope(req) {
  if (req.user.role === 'district_admin') {
    return req.query.localId ? Number(req.query.localId) : null;
  }
  return req.user.local_id || -1;
}

/** Factory: returns a helper that appends a local condition to a query. */
function makeLocalWhere(scope) {
  return (baseParams, alias) => {
    const params = [...baseParams];
    if (scope == null) return { params, sql: '' };
    params.push(scope);
    return { params, sql: ` AND ${alias}.local_id = $${params.length}` };
  };
}

const SERVICE_COUNTS_JOIN = `
  LEFT JOIN (
    SELECT a.service_id,
           COUNT(*) FILTER (WHERE a.status = 'present') AS present,
           COUNT(*) FILTER (WHERE a.status = 'absent')  AS absent,
           COUNT(*) FILTER (WHERE a.status = 'excused') AS excused,
           COUNT(*) AS marked,
           COUNT(*) FILTER (WHERE a.status = 'present' AND m.gender = 'male')   AS present_male,
           COUNT(*) FILTER (WHERE a.status = 'present' AND m.gender = 'female') AS present_female
      FROM attendance a
      JOIN members m ON m.id = a.member_id
     GROUP BY a.service_id
  ) a ON a.service_id = s.id`;

/** Aggregated report data over a date range (shape of GET /reports/summary). */
async function getReportSummary(db, { from, to, scope }) {
  const localWhere = makeLocalWhere(scope);

  const bsB = localWhere([from, to], 's');
  const { rows: byService } = await db.query({ text: `
    SELECT s.id, s.service_date, s.service_name, s.total_headcount, s.visitor_headcount, l.name AS location_name,
            COALESCE(a.present, 0)::int AS present,
            COALESCE(a.absent, 0)::int  AS absent,
            COALESCE(a.excused, 0)::int AS excused,
            COALESCE(a.present_male, 0)::int   AS present_male,
            COALESCE(a.present_female, 0)::int AS present_female,
            (COALESCE(a.present, 0) + COALESCE(s.visitor_headcount, 0))::int AS total_present
       FROM services s
       LEFT JOIN locations l ON l.id = s.location_id ${SERVICE_COUNTS_JOIN}
      WHERE s.service_date BETWEEN $1 AND $2${bsB.sql}
      ORDER BY s.service_date ASC`, values: bsB.params });

  const totals = byService.reduce(
    (acc, r) => ({
      present: acc.present + r.present,
      absent: acc.absent + r.absent,
      excused: acc.excused + r.excused,
      present_male: acc.present_male + r.present_male,
      present_female: acc.present_female + r.present_female,
    }),
    { present: 0, absent: 0, excused: 0, present_male: 0, present_female: 0 }
  );

  const rangeB = localWhere([from, to], 'm');
  const mLocal = rangeB.sql; // " AND m.local_id = $n" (empty when unscoped)

  const groupQuery = `
    SELECT g.name,
           COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'active'${mLocal}) AS active_members,
           COUNT(DISTINCT CASE WHEN a.status = 'present' AND s.id IS NOT NULL${mLocal} THEN m.id END) AS present_members,
           COUNT(a.id) FILTER (WHERE a.status = 'present' AND s.id IS NOT NULL${mLocal}) AS present_count,
           COUNT(a.id) FILTER (WHERE a.status = 'absent'  AND s.id IS NOT NULL${mLocal}) AS absent_count,
           COUNT(a.id) FILTER (WHERE a.status = 'excused' AND s.id IS NOT NULL${mLocal}) AS excused_count
      FROM member_groups g
      LEFT JOIN member_group_assignments mga ON mga.group_id = g.id
      LEFT JOIN members m ON m.id = mga.member_id
      LEFT JOIN attendance a ON a.member_id = m.id
      LEFT JOIN services s ON s.id = a.service_id AND s.service_date BETWEEN $1 AND $2
     GROUP BY g.id, g.name`;

  const noGroupQuery = `
    SELECT '(No group)' AS name,
           COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'active'${mLocal}) AS active_members,
           COUNT(DISTINCT CASE WHEN a.status = 'present' AND s.id IS NOT NULL${mLocal} THEN m.id END) AS present_members,
           COUNT(a.id) FILTER (WHERE a.status = 'present' AND s.id IS NOT NULL${mLocal}) AS present_count,
           COUNT(a.id) FILTER (WHERE a.status = 'absent'  AND s.id IS NOT NULL${mLocal}) AS absent_count,
           COUNT(a.id) FILTER (WHERE a.status = 'excused' AND s.id IS NOT NULL${mLocal}) AS excused_count
      FROM members m
      LEFT JOIN attendance a ON a.member_id = m.id
      LEFT JOIN services s ON s.id = a.service_id AND s.service_date BETWEEN $1 AND $2
     WHERE TRUE${mLocal}
       AND NOT EXISTS (SELECT 1 FROM member_group_assignments mga WHERE mga.member_id = m.id)`;

  const { rows: g1 } = await db.query({ text: groupQuery, values: rangeB.params });
  const { rows: g2 } = await db.query({ text: noGroupQuery, values: rangeB.params });
  const byGroup = [...g1, ...g2]
    .map((r) => ({
      ...r,
      active_members: Number(r.active_members),
      present_members: Number(r.present_members),
      present_count: Number(r.present_count),
      absent_count: Number(r.absent_count),
      excused_count: Number(r.excused_count),
    }))
    .sort((a, b) => b.active_members - a.active_members);

  const raB = localWhere([from, to], 'm');
  const { rows: repeatAbsentees } = await db.query({ text: `
     SELECT t.* FROM (
        SELECT m.id, m.full_name, gg.group_name, m.consecutive_absences, m.last_attended,
               (SELECT COUNT(*) FROM attendance a
                  JOIN services s ON s.id = a.service_id
                 WHERE a.member_id = m.id AND a.status = 'absent'
                   AND s.service_date BETWEEN $1 AND $2) AS absences_in_range
         FROM members m
         LEFT JOIN LATERAL (
              SELECT string_agg(g.name, ', ' ORDER BY g.name) AS group_name
                FROM member_group_assignments mga JOIN member_groups g ON g.id = mga.group_id
               WHERE mga.member_id = m.id
         ) gg ON true
        WHERE m.status = 'active'${raB.sql}
     ) t
      WHERE t.consecutive_absences >= 3 OR t.absences_in_range >= 4
      ORDER BY t.consecutive_absences DESC, t.absences_in_range DESC
      LIMIT 25`, values: raB.params });

  const ubB = localWhere([], 'u');
  const { rows: byUsher } = await db.query(
    `SELECT u.id, u.name,
            COUNT(a.id) AS records,
            COUNT(a.id) FILTER (WHERE a.status = 'present') AS present,
            COUNT(a.id) FILTER (WHERE a.status = 'absent')  AS absent,
            COUNT(a.id) FILTER (WHERE a.status = 'excused') AS excused
       FROM users u
       LEFT JOIN attendance a ON a.recorded_by_user_id = u.id
      WHERE u.role = 'usher'${ubB.sql}
      GROUP BY u.id, u.name
      ORDER BY records DESC`,
    ubB.params
  );

  return {
    from,
    to,
    byService,
    totals,
    byGroup,
    repeatAbsentees,
    byUsher: byUsher.map((u) => ({
      ...u,
      records: Number(u.records),
      present: Number(u.present),
      absent: Number(u.absent),
      excused: Number(u.excused),
    })),
  };
}

/** Local-by-local comparison (district admin only; unscoped by design). */
async function getLocalReport(db, { from, to }) {
  const { rows } = await db.query(
    `SELECT b.id, b.name, b.location,
            (SELECT COUNT(*) FROM members m WHERE m.local_id = b.id AND m.status = 'active') AS active_members,
            (SELECT COUNT(*) FROM follow_ups f JOIN members m2 ON m2.id = f.member_id
              WHERE f.status = 'open' AND m2.local_id = b.id) AS open_follow_ups,
            COUNT(DISTINCT s.id) AS services,
            COALESCE(SUM(a.present), 0)::int AS present,
            COALESCE(SUM(a.absent), 0)::int  AS absent,
            COALESCE(SUM(a.excused), 0)::int AS excused
       FROM locals b
       LEFT JOIN services s ON s.local_id = b.id AND s.service_date BETWEEN $1 AND $2
       LEFT JOIN (
         SELECT service_id,
                COUNT(*) FILTER (WHERE status = 'present') AS present,
                COUNT(*) FILTER (WHERE status = 'absent')  AS absent,
                COUNT(*) FILTER (WHERE status = 'excused') AS excused
           FROM attendance
          GROUP BY service_id
       ) a ON a.service_id = s.id
      WHERE b.status = 'active'
      GROUP BY b.id, b.name, b.location
      ORDER BY b.name ASC`,
    [from, to]
  );

  const locals = rows.map((r) => {
    const serviceCount = Number(r.services);
    const present = Number(r.present);
    return {
      ...r,
      active_members: Number(r.active_members),
      open_follow_ups: Number(r.open_follow_ups),
      services: serviceCount,
      present,
      absent: Number(r.absent),
      excused: Number(r.excused),
      avg_present_per_service: serviceCount > 0 ? Math.round((present / serviceCount) * 10) / 10 : null,
    };
  });

  // Church-wide roll-up for the district admin, including active members whose
  // local row no longer exists (local_id IS NULL) so nobody is invisible.
  const { rows: totalsRows } = await db.query(
    `SELECT (SELECT COUNT(*) FROM members WHERE status = 'active') AS total_active_members,
            (SELECT COUNT(*) FROM members WHERE local_id IS NULL) AS unassigned_members,
            (SELECT COUNT(*) FROM locals WHERE status = 'active') AS local_count`
  );
  const totals = {
    total_active_members: Number(totalsRows[0].total_active_members),
    unassigned_members: Number(totalsRows[0].unassigned_members),
    local_count: Number(totalsRows[0].local_count),
  };

  return { totals, locals };
}

module.exports = {
  todayStr,
  defaultRange,
  localScope,
  makeLocalWhere,
  SERVICE_COUNTS_JOIN,
  getReportSummary,
  getLocalReport,
};


