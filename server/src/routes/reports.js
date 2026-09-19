const express = require('express');
const db = require('../config/db');
const { asyncHandler } = require('../utils/errors');
const { authenticate, requireAdmin, requireDistrictAdmin } = require('../middleware/auth');

const { getServiceTotals } = require('../services/stats');
// Report SQL, local scoping and the workbook builder live in services/ so the
// JSON endpoints and the Excel export always describe the same numbers.
const {
  localScope,
  makeLocalWhere,
  todayStr,
  SERVICE_COUNTS_JOIN,
  defaultRange,
  getReportSummary,
  getLocalReport,
} = require('../services/reports');
const { buildReportWorkbook } = require('../services/reportExport');

const router = express.Router();
router.use(authenticate, requireAdmin);

/** Report window from the query string, defaulting to the last 90 days. */
function reportRange(req) {
  return defaultRange(req.query);
}

/** Everything the admin Overview page needs in one round-trip. */
router.get('/dashboard', asyncHandler(async (req, res) => {
  const today = todayStr();
  const scope = localScope(req);
  const localWhere = makeLocalWhere(scope);

  const latestB = localWhere([today], 's');
  const { rows: latestRows } = await db.query(
    `SELECT s.id, s.local_id, s.service_date, s.service_name, s.start_time, s.total_headcount, l.name AS location_name
       FROM services s LEFT JOIN locations l ON l.id = s.location_id
      WHERE s.service_date <= $1${latestB.sql}
      ORDER BY s.service_date DESC, s.start_time DESC NULLS LAST LIMIT 1`,
    latestB.params
  );
  const latestService = latestRows[0]
    ? { ...latestRows[0], totals: await getServiceTotals(db, latestRows[0].id, latestRows[0].local_id) }
    : null;

  const avgB = localWhere([today], 's');
  const { rows: avgRows } = await db.query(
    `SELECT ROUND(AVG(cnt), 1) AS avg FROM (
       SELECT COUNT(*) FILTER (WHERE a.status = 'present') AS cnt
         FROM services s JOIN attendance a ON a.service_id = s.id
        WHERE s.service_date <= $1${avgB.sql}
        GROUP BY s.id
        ORDER BY MAX(s.service_date) DESC
        LIMIT 4
     ) t`,
    avgB.params
  );

  const membersB = localWhere([], 'm');
  const { rows: memberCounts } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE m.status = 'active')   AS active,
            COUNT(*) FILTER (WHERE m.status = 'inactive') AS inactive
       FROM members m
      WHERE TRUE${membersB.sql}`,
    membersB.params
  );

  const fuB = localWhere([], 'm');
  const { rows: followUpCount } = await db.query(
    `SELECT COUNT(*) AS n
       FROM follow_ups f
       JOIN members m ON m.id = f.member_id
      WHERE f.status = 'open'${fuB.sql}`,
    fuB.params
  );

  const hpB = localWhere([], 'm');
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
      WHERE f.status = 'open' AND f.priority = 'high'${hpB.sql}
      ORDER BY f.absent_weeks DESC
      LIMIT 5`,
    hpB.params
  );

  const trendB = localWhere([today], 's');
  const trendSql = `SELECT s.id, s.service_date, s.service_name,
            COALESCE(a.present, 0)::int AS present,
            COALESCE(a.absent, 0)::int  AS absent,
            COALESCE(a.excused, 0)::int AS excused
       FROM services s ${SERVICE_COUNTS_JOIN}
      WHERE s.service_date <= $1${trendB.sql}
      ORDER BY s.service_date DESC LIMIT 12`;
  let trendRows;
  try {
    ({ rows: trendRows } = await db.query({ text: trendSql, values: trendB.params }));
  } catch (e) {
    console.error('[trend] dashboard trend query failed:', e.message);
    throw e;
  }
  trendRows.reverse(); // oldest -> newest for charting

  const rsB = localWhere([], 's');
  const { rows: recentServices } = await db.query(
    `SELECT s.id, s.service_date, s.service_name, s.total_headcount, l.name AS location_name,
            COALESCE(a.present, 0)::int AS present,
            COALESCE(a.absent, 0)::int  AS absent,
            COALESCE(a.excused, 0)::int AS excused
       FROM services s
       LEFT JOIN locations l ON l.id = s.location_id ${SERVICE_COUNTS_JOIN}
      WHERE TRUE${rsB.sql}
      ORDER BY s.service_date DESC LIMIT 5`,
    rsB.params
  );

  const lrB = localWhere([], 's');
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
      WHERE TRUE${lrB.sql}
      ORDER BY a.updated_at DESC LIMIT 10`,
    lrB.params
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

/** Aggregated report data over a date range (shared with the Excel export). */
router.get('/summary', asyncHandler(async (req, res) => {
  const { from, to } = reportRange(req);
  res.json(await getReportSummary(db, { from, to, scope: localScope(req) }));
}));

/**
 * Local-by-local attendance comparison (district admin only).
 * Powers the "compare attendance across locals" view.
 */
router.get('/locals', requireDistrictAdmin, asyncHandler(async (req, res) => {
  const { from, to } = reportRange(req);
  res.json({ from, to, ...(await getLocalReport(db, { from, to })) });
}));

/**
 * Excel download of everything the Reports and Visitors screens show: a Summary
 * dashboard with native Excel charts plus one sheet per table in the range.
 * District admins also get the local comparison sheet.
 */
router.get('/export', asyncHandler(async (req, res) => {
  const { from, to } = reportRange(req);

  const { buffer, filename, counts } = await buildReportWorkbook({
    from,
    to,
    scope: localScope(req),
    includeLocals: req.user.role === 'district_admin',
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Report-Rows', String(counts.attendance));
  if (counts.attendanceTruncated) res.setHeader('X-Report-Truncated', 'true');
  res.send(buffer);
}));

module.exports = router;


