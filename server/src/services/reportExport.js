'use strict';

/**
 * Builds the .xlsx report workbook: a Summary dashboard (with native, editable
 * Excel charts) plus one sheet per table on the Reports and Visitors screens.
 *
 * Every aggregate comes from services/reports.js, i.e. the same SQL the JSON
 * endpoints use, so the download can never disagree with the screen.
 */

const db = require('../config/db');
const { createWorkbook, toIsoDate } = require('../utils/xlsx');
const { getReportSummary, getLocalReport, makeLocalWhere } = require('./reports');
const { getSettingsMap } = require('./settings');
const { visitorStats } = require('./visitors');

/** Detail sheets are capped so an open-ended range cannot build an unusable file. */
const DETAIL_LIMIT = 20000;

// Fonts/fills need ARGB; chart series need plain RGB.
const INK = 'FF1F2937';
const MUTED = 'FF64748B';
const TEAL = '0891B2';
const TOTAL_FILL = 'FFEFF6FF';
const BLUE = '2563EB';
const GREEN = '16A34A';
const PINK = 'DB2777';

const TITLE_STYLE = { bold: true, size: 16, color: INK };
const SUBTITLE_STYLE = { size: 10, color: MUTED };
const SECTION_STYLE = { bold: true, border: 'top' };
const TOTAL_STYLE = { bold: true, border: 'top', fill: TOTAL_FILL };

/** Attendance records for the range, local-scoped exactly like the report. */
async function fetchAttendanceDetail(scope, from, to) {
  const localWhere = makeLocalWhere(scope);
  const b = localWhere([from, to], 's');
  const { rows } = await db.query({
    text: `
      SELECT s.service_date, s.service_name, m.full_name AS member_name,
             COALESCE((
               SELECT string_agg(g.name, ', ' ORDER BY g.name)
                 FROM member_group_assignments mga JOIN member_groups g ON g.id = mga.group_id
                WHERE mga.member_id = m.id
             ), '') AS group_name,
             a.status, ru.name AS recorded_by_name, a.recorded_at,
             uu.name AS updated_by_name, a.updated_at, a.notes
        FROM attendance a
        JOIN members m ON m.id = a.member_id
        JOIN services s ON s.id = a.service_id
        LEFT JOIN users ru ON ru.id = a.recorded_by_user_id
        LEFT JOIN users uu ON uu.id = a.updated_by_user_id
       WHERE s.service_date BETWEEN $1 AND $2${b.sql}
       ORDER BY s.service_date ASC, s.service_name ASC, m.full_name ASC
       LIMIT ${DETAIL_LIMIT}`,
    values: b.params,
  });
  return rows;
}

/** The member register for the signed-in admin's scope. */
async function fetchMembers(scope) {
  const localWhere = makeLocalWhere(scope);
  const b = localWhere([], 'm');
  const { rows } = await db.query({
    text: `
      SELECT m.full_name, m.member_code, m.status, m.gender, m.age, m.phone, m.email,
             br.name AS local_name, m.last_attended, m.consecutive_absences,
             COALESCE((
               SELECT string_agg(g.name, ', ' ORDER BY g.name)
                 FROM member_group_assignments mga JOIN member_groups g ON g.id = mga.group_id
                WHERE mga.member_id = m.id
             ), '') AS group_name
        FROM members m
        LEFT JOIN locals br ON br.id = m.local_id
       WHERE TRUE${b.sql}
       ORDER BY m.full_name ASC
       LIMIT ${DETAIL_LIMIT}`,
    values: b.params,
  });
  return rows;
}

/**
 * Visitor register. The local predicate mirrors services/visitors.js: a visitor
 * belongs to the local of the service they attended, or - when the visit had no
 * service - to the local of the user who captured them.
 */
async function fetchVisitors(scope, { followupStatus, search } = {}) {
  const where = [];
  const params = [];
  if (scope != null) {
    params.push(scope);
    const n = params.length;
    where.push(
      `(v.service_id IN (SELECT id FROM services WHERE local_id = $${n})
        OR (v.service_id IS NULL AND v.created_by IN (SELECT id FROM users WHERE local_id = $${n})))`
    );
  }
  if (followupStatus) { params.push(followupStatus); where.push(`v.followup_status = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    where.push(`(v.full_name ILIKE $${n} OR COALESCE(v.phone, '') ILIKE $${n})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await db.query({
    text: `
      SELECT v.full_name, v.gender, v.phone, v.email, v.age_group, v.home_area, v.invited_by,
             v.first_visit_date, v.last_visit_date, v.visit_count, v.followup_status,
             s.service_name, s.service_date, u.name AS created_by_name
        FROM visitors v
        LEFT JOIN services s ON s.id = v.service_id
        LEFT JOIN users u ON u.id = v.created_by
        ${whereSql}
       ORDER BY v.first_visit_date ASC, v.full_name ASC
       LIMIT ${DETAIL_LIMIT}`,
    values: params,
  });
  return rows;
}

/** Member/follow-up headline counts (same queries as the dashboard endpoint). */
async function fetchOverviewCounts(scope) {
  const memberB = makeLocalWhere(scope)([], 'm');
  const { rows: memberRows } = await db.query({
    text: `SELECT COUNT(*) FILTER (WHERE m.status = 'active')   AS active,
                  COUNT(*) FILTER (WHERE m.status = 'inactive') AS inactive
             FROM members m
            WHERE TRUE${memberB.sql}`,
    values: memberB.params,
  });
  const followUpB = makeLocalWhere(scope)([], 'm');
  const { rows: followUpRows } = await db.query({
    text: `SELECT COUNT(*) AS n
             FROM follow_ups f
             JOIN members m ON m.id = f.member_id
            WHERE f.status = 'open'${followUpB.sql}`,
    values: followUpB.params,
  });
  return {
    activeMembers: Number(memberRows[0].active),
    inactiveMembers: Number(memberRows[0].inactive),
    openFollowUps: Number(followUpRows[0].n),
  };
}

// ------------------------------------------------------------------- sheets

/** "1 service" / "2 services" â€” totals rows read better with real plurals. */
function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Summary dashboard: a KPI table, then one small (label, value) table per chart.
 * Each chart is given an explicit row window (rowStart/rowCount) into those
 * tables and is drawn to the right of the data, in columns D..M.
 */
function buildSummarySheet({ from, to, summary, counts, generatedAt, churchName }) {
  const rows = [];
  const add = (label, value) => rows.push({ label, value });
  const section = (text) => rows.push({ values: { label: text, value: null }, style: SECTION_STYLE });

  const services = summary.byService.length;
  const visitors = summary.byService.reduce((n, r) => n + Number(r.visitor_headcount || 0), 0);

  add('Services held', services);
  add('Present (members)', summary.totals.present);
  add('Absent', summary.totals.absent);
  add('Excused', summary.totals.excused);
  add('Visitors recorded', visitors);
  add('Average present per service', services ? Math.round((summary.totals.present / services) * 10) / 10 : 0);
  add('Active members', counts.activeMembers);
  add('Inactive members', counts.inactiveMembers);
  add('Open follow-ups', counts.openFollowUps);

  section('Attendance by service');
  const lineStart = rows.length;
  summary.byService.forEach((r) => add(toIsoDate(r.service_date), r.present));
  const lineCount = rows.length - lineStart;

  section('Gender split of present members');
  const pieStart = rows.length;
  add('Male', summary.totals.present_male);
  add('Female', summary.totals.present_female);

  section('Present members by group');
  const barStart = rows.length;
  summary.byGroup.forEach((g) => add(g.name, g.present_members));
  const barCount = rows.length - barStart;

  const charts = [];
  if (lineCount > 0) {
    charts.push({
      kind: 'line',
      title: 'Present per service',
      rowStart: lineStart,
      rowCount: lineCount,
      legend: false,
      anchor: { col: 3, row: 0, cols: 9, rows: 15 },
      series: [{ name: 'Present', categoriesKey: 'label', valuesKey: 'value', color: BLUE }],
    });
  }
  if (summary.totals.present_male + summary.totals.present_female > 0) {
    charts.push({
      kind: 'pie',
      title: 'Gender split of present members',
      rowStart: pieStart,
      rowCount: 2,
      pointColors: [BLUE, PINK],
      anchor: { col: 3, row: 15, cols: 9, rows: 15 },
      series: [{ name: 'Present', categoriesKey: 'label', valuesKey: 'value' }],
    });
  }
  if (barCount > 0) {
    charts.push({
      kind: 'bar',
      title: 'Present members by group',
      rowStart: barStart,
      rowCount: barCount,
      legend: false,
      anchor: { col: 3, row: 30, cols: 9, rows: 15 },
      series: [{ name: 'Present members', categoriesKey: 'label', valuesKey: 'value', color: GREEN }],
    });
  }

  return {
    name: 'Summary',
    tabColor: BLUE,
    header: false,
    band: false,
    freeze: false,
    columns: [
      { key: 'label', label: 'Metric', type: 'text', width: 30 },
      { key: 'value', label: 'Value', type: 'number', width: 14, numFmt: '#,##0.##' },
    ],
    banner: [
      [{ text: `${churchName} attendance report`, span: 2, style: TITLE_STYLE }],
      [
        { text: `Period ${from} to ${to}`, span: 1, style: SUBTITLE_STYLE },
        { text: `Generated ${generatedAt}`, span: 1, style: SUBTITLE_STYLE },
      ],
    ],
    rows,
    charts,
  };
}

/** One row per service in the range, closed by a totals row. */
function buildServiceSheet({ byService, totals }) {
  const sum = (key) => byService.reduce((n, r) => n + Number(r[key] || 0), 0);
  return {
    name: 'By service',
    title: 'Attendance by service',
    tabColor: BLUE,
    landscape: true,
    columns: [
      { key: 'service_date', label: 'Date', type: 'date', width: 12 },
      { key: 'service_name', label: 'Service', type: 'text', width: 24 },
      { key: 'location_name', label: 'Location', type: 'text', width: 18 },
      { key: 'present', label: 'Present', type: 'int' },
      { key: 'absent', label: 'Absent', type: 'int' },
      { key: 'excused', label: 'Excused', type: 'int' },
      { key: 'present_male', label: 'Male', type: 'int' },
      { key: 'present_female', label: 'Female', type: 'int' },
      { key: 'visitor_headcount', label: 'Visitors', type: 'int' },
      { key: 'total_present', label: 'Total present', type: 'int' },
      { key: 'total_headcount', label: 'Headcount', type: 'int' },
    ],
    rows: [
      ...byService,
      {
        values: {
          service_name: `Total (${plural(byService.length, 'service')})`,
          present: totals.present,
          absent: totals.absent,
          excused: totals.excused,
          present_male: totals.present_male,
          present_female: totals.present_female,
          visitor_headcount: sum('visitor_headcount'),
          total_present: sum('total_present'),
          total_headcount: sum('total_headcount'),
        },
        style: TOTAL_STYLE,
      },
    ],
  };
}

/** Group roll-up, including members who belong to no group. */
function buildGroupSheet(byGroup) {
  return {
    name: 'By group',
    title: 'Attendance by group',
    tabColor: GREEN,
    landscape: true,
    columns: [
      { key: 'name', label: 'Group', type: 'text', width: 26 },
      { key: 'active_members', label: 'Active members', type: 'int' },
      { key: 'present_members', label: 'Present members', type: 'int' },
      { key: 'present_count', label: 'Present count', type: 'int' },
      { key: 'absent_count', label: 'Absent', type: 'int' },
      { key: 'excused_count', label: 'Excused', type: 'int' },
      { key: 'rate', label: 'Marked attendance rate', type: 'number', numFmt: '0.0"%"' },
    ],
    rows: byGroup.map((g) => {
      const marked = g.present_count + g.absent_count + g.excused_count;
      return { ...g, rate: marked ? Math.round((g.present_count / marked) * 1000) / 10 : null };
    }),
  };
}

/** Marking activity per usher. */
function buildUsherSheet(byUsher) {
  return {
    name: 'By usher',
    title: 'Attendance recorded by usher',
    tabColor: MUTED,
    landscape: true,
    columns: [
      { key: 'name', label: 'Usher', type: 'text', width: 26 },
      { key: 'records', label: 'Records', type: 'int' },
      { key: 'present', label: 'Present', type: 'int' },
      { key: 'absent', label: 'Absent', type: 'int' },
      { key: 'excused', label: 'Excused', type: 'int' },
    ],
    rows: byUsher,
  };
}

/** Members the report flagged for follow-up in this period. */
function buildAbsenteeSheet(repeatAbsentees) {
  return {
    name: 'Repeat absentees',
    title: 'Repeat absentees in this period',
    tabColor: PINK,
    landscape: true,
    columns: [
      { key: 'full_name', label: 'Member', type: 'text', width: 26 },
      { key: 'group_name', label: 'Groups', type: 'text', width: 26 },
      { key: 'consecutive_absences', label: 'Consecutive absences', type: 'int' },
      { key: 'last_attended', label: 'Last attended', type: 'date', width: 14 },
      { key: 'absences_in_range', label: 'Absences in period', type: 'int' },
    ],
    rows: repeatAbsentees,
  };
}

/** Visitors by service, mirroring the table on the Reports screen. */
function buildVisitorStatsSheet(items) {
  const sum = (key) => items.reduce((n, r) => n + Number(r[key] || 0), 0);
  return {
    name: 'Visitors by service',
    title: 'Visitors by service',
    tabColor: TEAL,
    landscape: true,
    columns: [
      { key: 'service_date', label: 'Date', type: 'date', width: 12 },
      { key: 'service_name', label: 'Service', type: 'text', width: 24 },
      { key: 'total_visitors', label: 'Visitors', type: 'int' },
      { key: 'first_time', label: 'First time', type: 'int' },
      { key: 'returning', label: 'Returning', type: 'int' },
      { key: 'male', label: 'Male', type: 'int' },
      { key: 'female', label: 'Female', type: 'int' },
      { key: 'converted', label: 'Joined', type: 'int' },
    ],
    rows: [
      ...items,
      {
        values: {
          service_name: `Total (${plural(items.length, 'service')})`,
          total_visitors: sum('total_visitors'),
          first_time: sum('first_time'),
          returning: sum('returning'),
          male: sum('male'),
          female: sum('female'),
          converted: sum('converted'),
        },
        style: TOTAL_STYLE,
      },
    ],
  };
}

/** The visitor register (the Visitors screen, as a sheet). */
function buildVisitorSheet(visitors) {
  return {
    name: 'Visitors register',
    title: `${visitors.length} visitors in this period`,
    tabColor: TEAL,
    landscape: true,
    autoFilter: true,
    columns: [
      { key: 'full_name', label: 'Visitor', type: 'text', width: 24 },
      { key: 'gender', label: 'Gender', type: 'text', width: 10 },
      { key: 'phone', label: 'Phone', type: 'text', width: 16 },
      { key: 'email', label: 'Email', type: 'text', width: 24 },
      { key: 'age_group', label: 'Age group', type: 'text', width: 12 },
      { key: 'home_area', label: 'Home area', type: 'text', width: 18 },
      { key: 'invited_by', label: 'Invited by', type: 'text', width: 18 },
      { key: 'first_visit_date', label: 'First visit', type: 'date', width: 12 },
      { key: 'last_visit_date', label: 'Last visit', type: 'date', width: 12 },
      { key: 'visit_count', label: 'Visits', type: 'int' },
      { key: 'followup_status', label: 'Follow-up', type: 'text', width: 14 },
      { key: 'service_name', label: 'Last service', type: 'text', width: 22 },
      { key: 'created_by_name', label: 'Captured by', type: 'text', width: 18 },
    ],
    rows: visitors,
  };
}
/** The member register for the signed-in admin's scope. */
function buildMemberSheet(members) {
  return {
    name: 'Members',
    title: `${members.length} members in scope`,
    tabColor: GREEN,
    landscape: true,
    autoFilter: true,
    columns: [
      { key: 'full_name', label: 'Member', type: 'text', width: 24 },
      { key: 'member_code', label: 'Code', type: 'text', width: 12 },
      { key: 'status', label: 'Status', type: 'text', width: 10 },
      { key: 'gender', label: 'Gender', type: 'text', width: 10 },
      { key: 'age', label: 'Age', type: 'int', width: 8 },
      { key: 'phone', label: 'Phone', type: 'text', width: 16 },
      { key: 'email', label: 'Email', type: 'text', width: 24 },
      { key: 'local_name', label: 'Local', type: 'text', width: 18 },
      { key: 'group_name', label: 'Groups', type: 'text', width: 24 },
      { key: 'last_attended', label: 'Last attended', type: 'date', width: 12 },
      { key: 'consecutive_absences', label: 'Consecutive absences', type: 'int' },
    ],
    rows: members,
  };
}

/** Attendance detail: one row per member per service, including the audit columns. */
function buildAttendanceSheet(rows) {
  const capped = rows.length >= DETAIL_LIMIT;
  return {
    name: 'Attendance detail',
    title: capped
      ? `Attendance detail (first ${DETAIL_LIMIT} rows â€” narrow the date range for a complete file)`
      : `Attendance detail (${rows.length} rows)`,
    tabColor: MUTED,
    landscape: true,
    autoFilter: true,
    columns: [
      { key: 'service_date', label: 'Date', type: 'date', width: 12 },
      { key: 'service_name', label: 'Service', type: 'text', width: 24 },
      { key: 'member_name', label: 'Member', type: 'text', width: 24 },
      { key: 'group_name', label: 'Groups', type: 'text', width: 24 },
      { key: 'status', label: 'Status', type: 'text', width: 10 },
      { key: 'recorded_by_name', label: 'Recorded by', type: 'text', width: 18 },
      { key: 'recorded_at', label: 'Recorded at', type: 'datetime', width: 18 },
      { key: 'updated_by_name', label: 'Last corrected by', type: 'text', width: 18 },
      { key: 'updated_at', label: 'Corrected at', type: 'datetime', width: 18 },
      { key: 'notes', label: 'Notes', type: 'text', width: 40 },
    ],
    rows,
  };
}

/** District-only comparison: every active local side by side. */
function buildLocalSheet({ locals, totals }) {
  const sum = (key) => locals.reduce((n, r) => n + Number(r[key] || 0), 0);
  const services = sum('services');
  return {
    name: 'By local',
    title: `${totals.local_count} active locals Â· ${totals.total_active_members} active members`,
    tabColor: 'FF6D28D9',
    landscape: true,
    columns: [
      { key: 'name', label: 'Local', type: 'text', width: 22 },
      { key: 'location', label: 'Location', type: 'text', width: 18 },
      { key: 'active_members', label: 'Active members', type: 'int' },
      { key: 'open_follow_ups', label: 'Open follow-ups', type: 'int' },
      { key: 'services', label: 'Services', type: 'int' },
      { key: 'present', label: 'Present', type: 'int' },
      { key: 'absent', label: 'Absent', type: 'int' },
      { key: 'excused', label: 'Excused', type: 'int' },
      { key: 'avg_present_per_service', label: 'Avg present / service', type: 'number', numFmt: '#,##0.0' },
    ],
    rows: [
      ...locals,
      {
        values: {
          name: `All locals (${locals.length})`,
          active_members: sum('active_members'),
          open_follow_ups: sum('open_follow_ups'),
          services,
          present: sum('present'),
          absent: sum('absent'),
          excused: sum('excused'),
          avg_present_per_service: services ? Math.round((sum('present') / services) * 10) / 10 : null,
        },
        style: TOTAL_STYLE,
      },
    ],
  };
}

// ----------------------------------------------------------------- assembling

/**
 * Build the workbook for one export request.
 *
 * `scope` limits the data to a single local (null = every local for a district
 * admin), `from`/`to` are ISO dates and `includeLocals` adds the district-only
 * local comparison sheet. Returns the .xlsx bytes, the download filename and the
 * row counts of each sheet (so the route can report what was written).
 */
async function buildReportWorkbook({ from, to, scope = null, includeLocals = false }) {
  const [summary, settings, counts, visitors, memberRows, attendanceRows, localReport, visitorRows] = await Promise.all([
    getReportSummary(db, { from, to, scope }),
    getSettingsMap(db),
    fetchOverviewCounts(scope),
    fetchVisitors(scope),
    fetchMembers(scope),
    fetchAttendanceDetail(scope, from, to),
    includeLocals ? getLocalReport(db, { from, to }) : Promise.resolve(null),
    visitorStats({ from, to, localId: scope || undefined }),
  ]);

  const now = new Date();
  const generatedAt = `${toIsoDate(now)} ${now.toTimeString().slice(0, 5)}`;
  const churchName = (settings && settings.church_name) || process.env.CHURCH_NAME || 'Church Attendance Tracker';

  const sheets = [
    buildSummarySheet({ from, to, summary, counts, generatedAt, churchName }),
    buildServiceSheet({ byService: summary.byService, totals: summary.totals }),
    buildGroupSheet(summary.byGroup),
    buildUsherSheet(summary.byUsher),
    buildAbsenteeSheet(summary.repeatAbsentees),
    buildVisitorStatsSheet(visitorRows),
    buildVisitorSheet(visitors),
    buildMemberSheet(memberRows),
    buildAttendanceSheet(attendanceRows),
  ];
  if (localReport) sheets.push(buildLocalSheet(localReport));

  const buffer = await createWorkbook({
    properties: {
      title: `Attendance report ${from} to ${to}`,
      subject: 'Attendance report',
      creator: churchName,
      description: `Generated by Church Attendance Tracker on ${generatedAt}`,
      created: now,
    },
    sheets,
  });

  return {
    buffer,
    filename: `attendance-report-${from}-to-${to}.xlsx`,
    generatedAt,
    counts: {
      services: summary.byService.length,
      members: memberRows.length,
      visitors: visitors.length,
      attendance: attendanceRows.length,
      attendanceTruncated: attendanceRows.length >= DETAIL_LIMIT,
      locals: localReport ? localReport.locals.length : 0,
    },
  };
}

module.exports = {
  DETAIL_LIMIT,
  buildReportWorkbook,
  fetchAttendanceDetail,
  fetchMembers,
  fetchVisitors,
  fetchOverviewCounts,
};


