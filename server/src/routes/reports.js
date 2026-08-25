const express = require('express');
const db = require('../config/db');
const { asyncHandler } = require('../utils/errors');
const { vDate } = require('../utils/validate');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getServiceTotals } = require('../services/stats');

const router = express.Router();
router.use(authenticate, requireAdmin);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

/** Everything the admin Overview page needs in one round-trip. */
router.get('/dashboard', asyncHandler(async (req, res) => {
  const today = todayStr();

  const { rows: latestRows } = await db.query(
    `SELECT s.id, s.service_date, s.service_name, s.start_time, s.total_headcount, l.name AS location_name
       FROM services s LEFT JOIN locations l ON l.id = s.location_id
      WHERE s.service_date <= $1
      ORDER BY s.service_date DESC, s.start_time DESC NULLS LAST LIMIT 1`,
    [today]
  );
  const latestService = latestRows[0]
    ? { ...latestRows[0], totals: await getServiceTotals(db, latestRows[0].id) }
    : null;

  const { rows: avgRows } = await db.query(
    `SELECT ROUND(AVG(cnt), 1) AS avg FROM (
       SELECT COUNT(*) FILTER (WHERE a.status = 'present') AS cnt
         FROM services s JOIN attendance a ON a.service_id = s.id
        WHERE s.service_date <= $1
        GROUP BY s.id
        ORDER BY MAX(s.service_date) DESC
        LIMIT 4
     ) t`,
    [today]
  );

  const { rows: memberCounts } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'active')   AS active,
            COUNT(*) FILTER (WHERE status = 'inactive') AS inactive
       FROM members`
  );

  const { rows: followUpCount } = await db.query(
    `SELECT COUNT(*) AS n FROM follow_ups WHERE status = 'open'`
  );

  const { rows: highPriority } = await db.query(
    `SELECT f.id, f.member_id, f.absent_weeks, f.reason, f.priority, f.assigned_to,
            m.full_name AS member_name,
            COALESCE((
              SELECT string_agg(g.name, ', ' ORDER BY g.name)
                FROM member_group_assignments mga JOIN member_groups g ON g.id = mga.group_id
               WHERE mga.member_id = m.id
            ), '') AS group_name
       FROM follow_ups f
       JOIN members m ON m.id = f.member_id
      WHERE f.status = 'open' AND f.priority = 'high'
      ORDER BY f.absent_weeks DESC
      LIMIT 5`
  );

  const trendSql = `SELECT s.id, s.service_date, s.service_name,
            COALESCE(a.present, 0)::int AS present,
            COALESCE(a.absent, 0)::int  AS absent,
            COALESCE(a.excused, 0)::int AS excused
       FROM services s ${SERVICE_COUNTS_JOIN}
      WHERE s.service_date <= $1
      ORDER BY s.service_date DESC LIMIT 12`;
  let trendRows;
  try {
    ({ rows: trendRows } = await db.query({ text: trendSql, values: [today] }));
  } catch (e) {
    console.error('[trend] dashboard trend query failed:', e.message);
    throw e;
  }
  trendRows.reverse(); // oldest -> newest for charting

  const { rows: recentServices } = await db.query(
    `SELECT s.id, s.service_date, s.service_name, s.total_headcount, l.name AS location_name,
            COALESCE(a.present, 0)::int AS present,
            COALESCE(a.absent, 0)::int  AS absent,
            COALESCE(a.excused, 0)::int AS excused
       FROM services s
       LEFT JOIN locations l ON l.id = s.location_id ${SERVICE_COUNTS_JOIN}
      ORDER BY s.service_date DESC LIMIT 5`
  );

  const { rows: latestRecords } = await db.query(
    `SELECT a.id, a.status, a.recorded_at, a.updated_at,
            m.id AS member_id, m.full_name AS member_name,
            s.service_name, s.service_date,
            COALESCE(uu.name, ru.name) AS recorded_by_name
       FROM attendance a
       JOIN members m ON m.id = a.member_id
       JOIN services s ON s.id = a.service_id
       LEFT JOIN users ru ON ru.id = a.recorded_by_user_id
       LEFT JOIN users uu ON uu.id = a.updated_by_user_id
      ORDER BY a.updated_at DESC LIMIT 10`
  );

  res.json({
    latestService,
    avgRecentAttendance: avgRows[0].avg === null ? null : Number(avgRows[0].avg),
    totalActiveMembers: Number(memberCounts[0].active),
    totalInactiveMembers: Number(memberCounts[0].inactive),
    openFollowUps: Number(followUpCount[0].n),
    highPriorityFollowUps: highPriority,
    trend: trendRows,
    recentServices,
    latestRecords,
  });
}));

/** Aggregated report data over a date range. */
router.get('/summary', asyncHandler(async (req, res) => {
  const to = vDate(req.query, 'to') || todayStr();
  const defaultFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = vDate(req.query, 'from') || defaultFrom;

  const { rows: byService } = await db.query({ text: `
    SELECT s.id, s.service_date, s.service_name, s.total_headcount, l.name AS location_name,
            COALESCE(a.present, 0)::int AS present,
            COALESCE(a.absent, 0)::int  AS absent,
            COALESCE(a.excused, 0)::int AS excused,
            COALESCE(a.present_male, 0)::int   AS present_male,
            COALESCE(a.present_female, 0)::int AS present_female
       FROM services s
       LEFT JOIN locations l ON l.id = s.location_id ${SERVICE_COUNTS_JOIN}
      WHERE s.service_date BETWEEN $1 AND $2
      ORDER BY s.service_date ASC`, values: [from, to] });

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

  const groupQuery = `
    SELECT g.name,
           COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'active') AS active_members,
           COUNT(DISTINCT CASE WHEN a.status = 'present' AND s.id IS NOT NULL THEN m.id END) AS present_members,
           COUNT(a.id) FILTER (WHERE a.status = 'present' AND s.id IS NOT NULL) AS present_count,
           COUNT(a.id) FILTER (WHERE a.status = 'absent'  AND s.id IS NOT NULL) AS absent_count,
           COUNT(a.id) FILTER (WHERE a.status = 'excused' AND s.id IS NOT NULL) AS excused_count
      FROM member_groups g
      LEFT JOIN member_group_assignments mga ON mga.group_id = g.id
      LEFT JOIN members m ON m.id = mga.member_id
      LEFT JOIN attendance a ON a.member_id = m.id
      LEFT JOIN services s ON s.id = a.service_id AND s.service_date BETWEEN $1 AND $2
     GROUP BY g.id, g.name`;

  const noGroupQuery = `
    SELECT '(No group)' AS name,
           COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'active') AS active_members,
           COUNT(DISTINCT CASE WHEN a.status = 'present' AND s.id IS NOT NULL THEN m.id END) AS present_members,
           COUNT(a.id) FILTER (WHERE a.status = 'present' AND s.id IS NOT NULL) AS present_count,
           COUNT(a.id) FILTER (WHERE a.status = 'absent'  AND s.id IS NOT NULL) AS absent_count,
           COUNT(a.id) FILTER (WHERE a.status = 'excused' AND s.id IS NOT NULL) AS excused_count
      FROM members m
      LEFT JOIN attendance a ON a.member_id = m.id
      LEFT JOIN services s ON s.id = a.service_id AND s.service_date BETWEEN $1 AND $2
     WHERE NOT EXISTS (SELECT 1 FROM member_group_assignments mga WHERE mga.member_id = m.id)`;

  const { rows: g1 } = await db.query({ text: groupQuery, values: [from, to] });
  const { rows: g2 } = await db.query({ text: noGroupQuery, values: [from, to] });
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
        WHERE m.status = 'active'
     ) t
      WHERE t.consecutive_absences >= 3 OR t.absences_in_range >= 4
      ORDER BY t.consecutive_absences DESC, t.absences_in_range DESC
      LIMIT 25`, values: [from, to] });

  const { rows: byUsher } = await db.query(
    `SELECT u.id, u.name,
            COUNT(a.id) AS records,
            COUNT(a.id) FILTER (WHERE a.status = 'present') AS present,
            COUNT(a.id) FILTER (WHERE a.status = 'absent')  AS absent,
            COUNT(a.id) FILTER (WHERE a.status = 'excused') AS excused
       FROM users u
       LEFT JOIN attendance a ON a.recorded_by_user_id = u.id
      WHERE u.role = 'usher'
      GROUP BY u.id, u.name
      ORDER BY records DESC`
  );

  res.json({
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
  });
}));

module.exports = router;