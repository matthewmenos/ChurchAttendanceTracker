'use strict';

const JSZip = require('jszip');

// The export service is exercised end-to-end here without Postgres: the pool is
// replaced by a fake that answers each query the service issues.
jest.mock('../../src/config/db', () => ({ query: jest.fn() }));

const db = require('../../src/config/db');
const { dateToSerial } = require('../../src/utils/xlsx');
const { buildReportWorkbook } = require('../../src/services/reportExport');

const BY_SERVICE = [
  { id: 1, service_date: '2024-02-25', service_name: 'Sunday Service', total_headcount: 140, visitor_headcount: 4, location_name: 'Main Hall', present: 96, absent: 14, excused: 2, present_male: 40, present_female: 56, total_present: 100 },
  { id: 2, service_date: '2024-03-03', service_name: 'Sunday Service', total_headcount: 150, visitor_headcount: 5, location_name: 'Main Hall', present: 100, absent: 12, excused: 3, present_male: 42, present_female: 58, total_present: 105 },
];

/**
 * First matching pattern wins, so the list is ordered from the most to the least
 * distinctive SQL. Any query that is not listed fails the test loudly.
 */
const RESPONSES = [
  { match: 'SELECT s.id, s.service_date', rows: BY_SERVICE },
  { match: "SELECT '(No group)' AS name", rows: [{ name: '(No group)', active_members: '2', present_members: '1', present_count: '1', absent_count: '1', excused_count: '0' }] },
  { match: 'LEFT JOIN member_group_assignments mga ON mga.group_id = g.id', rows: [{ name: 'Ushering', active_members: '4', present_members: '3', present_count: '3', absent_count: '1', excused_count: '0' }] },
  { match: 'SELECT t.* FROM (', rows: [{ id: 9, full_name: 'Grace Ade', group_name: 'Ushering', consecutive_absences: 4, last_attended: '2024-01-14', absences_in_range: 4 }] },
  { match: 'FROM users u', rows: [{ id: 3, name: 'Ruth Usher', records: '210', present: '180', absent: '22', excused: '8' }] },
  { match: 'AS active,', rows: [{ active: '120', inactive: '9' }] },
  { match: 'FROM follow_ups f', rows: [{ n: '7' }] },
  { match: 'FROM settings', rows: [{ key: 'church_name', value: 'Grace Chapel' }] },
  { match: 'SELECT m.full_name, m.member_code', rows: [{ full_name: 'Ada Mensah', member_code: 'M-001', status: 'active', gender: 'female', age: 34, phone: '555-0100', email: 'ada@example.com', branch_name: 'Central', last_attended: '2024-03-03', consecutive_absences: 0, group_name: 'Ushering' }] },
  { match: 'SELECT v.full_name, v.gender', rows: [{ full_name: 'Kwesi Boateng', gender: 'male', phone: '555-0199', email: null, age_group: '25-34', home_area: 'East Legon', invited_by: 'Ada Mensah', first_visit_date: '2024-03-03', last_visit_date: '2024-03-03', visit_count: 1, followup_status: 'new', service_name: 'Sunday Service', service_date: '2024-03-03', created_by_name: 'Ruth Usher' }] },
  { match: 'AS member_name,', rows: [{ service_date: '2024-03-03', service_name: 'Sunday Service', member_name: 'Ada Mensah', group_name: 'Ushering', status: 'present', recorded_by_name: 'Ruth Usher', recorded_at: '2024-03-03T09:15:00', updated_by_name: null, updated_at: null, notes: null }] },
  { match: 'LEFT JOIN visitors v ON v.service_id = s.id', rows: [{ id: 2, service_name: 'Sunday Service', service_date: '2024-03-03', total_visitors: '5', first_time: '3', returning: '2', male: '2', female: '3', converted: '1' }] },
  { match: 'FROM branches b', rows: [{ id: 1, name: 'Central', location: 'Accra', active_members: '70', open_follow_ups: '4', services: '9', present: '540', absent: '60', excused: '12', avg_present_per_service: 60 }] },
  { match: 'AS total_active_members', rows: [{ total_active_members: '129', unassigned_members: '9', branch_count: '3' }] },
];

const seen = [];

beforeEach(() => {
  seen.length = 0;
  db.query.mockReset();
  db.query.mockImplementation(async (arg) => {
    const text = typeof arg === 'string' ? arg : arg.text;
    seen.push(text);
    const hit = RESPONSES.find((r) => text.includes(r.match));
    if (!hit) throw new Error(`unexpected query: ${text.slice(0, 90)}`);
    return { rows: hit.rows, rowCount: hit.rows.length };
  });
});

/** Unzip a workbook buffer into a { partPath: xml } map plus the sheet names. */
async function openWorkbook(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const parts = {};
  for (const name of Object.keys(zip.files)) {
    if (!zip.files[name].dir) parts[name] = await zip.file(name).async('string');
  }
  const sheetNames = [...parts['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  return { parts, sheetNames };
}
describe('report export workbook', () => {
  test('writes a sheet per Reports table, with the local sheet for a district admin', async () => {
    const { buffer, filename, counts } = await buildReportWorkbook({
      from: '2024-01-01',
      to: '2024-03-31',
      scope: null,
      includeBranches: true,
    });

    expect(filename).toBe('attendance-report-2024-01-01-to-2024-03-31.xlsx');
    expect(buffer.subarray(0, 2).toString('utf8')).toBe('PK');

    const { sheetNames } = await openWorkbook(buffer);
    expect(sheetNames).toEqual([
      'Summary',
      'By service',
      'By group',
      'By usher',
      'Repeat absentees',
      'Visitors by service',
      'Visitors register',
      'Members',
      'Attendance detail',
      'By local',
    ]);
    expect(counts).toEqual({
      services: 2,
      members: 1,
      visitors: 1,
      attendance: 1,
      attendanceTruncated: false,
      branches: 1,
    });
  });

  test('charts the summary dashboard from the sheet data itself', async () => {
    const { buffer } = await buildReportWorkbook({ from: '2024-01-01', to: '2024-03-31', scope: null });
    const { parts, sheetNames } = await openWorkbook(buffer);

    expect(sheetNames).toEqual([
      'Summary',
      'By service',
      'By group',
      'By usher',
      'Repeat absentees',
      'Visitors by service',
      'Visitors register',
      'Members',
      'Attendance detail',
    ]);

    const line = parts['xl/charts/chart1.xml'];
    expect(line).toContain('<c:lineChart>');
    expect(line).toContain('<c:v>2024-02-25</c:v>'); // cached category label
    expect(line).toContain('<c:v>96</c:v>'); // cached series value
    expect(parts['xl/charts/chart2.xml']).toContain('<c:pieChart>');
    expect(parts['xl/charts/chart3.xml']).toContain('<c:barChart>');
    expect(parts['xl/worksheets/_rels/sheet1.xml.rels']).toContain('Target="../drawings/drawing1.xml"');
    // The KPI charts must plot their own little tables, not the whole dashboard.
    expect(parts['xl/charts/chart2.xml']).toContain("'Summary'!$B$");
  });

  test('types dates, timestamps and totals correctly', async () => {
    const { buffer } = await buildReportWorkbook({ from: '2024-01-01', to: '2024-03-31', scope: null });
    const { parts } = await openWorkbook(buffer);

    // Dates become Excel serials; timestamps keep their time-of-day fraction.
    expect(parts['xl/worksheets/sheet2.xml']).toContain(`<v>${dateToSerial('2024-03-03')}</v>`);
    expect(parts['xl/worksheets/sheet9.xml']).toMatch(/<c r="G3" s="\d+"><v>45\d{3}\.\d+<\/v><\/c>/);
    expect(parts['xl/styles.xml']).toContain('formatCode="yyyy-mm-dd"');
    expect(parts['xl/styles.xml']).toContain('formatCode="yyyy-mm-dd hh:mm"');

    // Every table is closed out with a bold, filled totals row.
    expect(parts['xl/worksheets/sheet2.xml']).toContain('Total (2 services)');
    expect(parts['xl/worksheets/sheet6.xml']).toContain('Total (1 service)');
    expect(parts['xl/styles.xml']).toContain('EFF6FF');
  });

  test('omits the local sheet for a local-scoped admin', async () => {
    const { buffer, counts } = await buildReportWorkbook({
      from: '2024-01-01',
      to: '2024-03-31',
      scope: 7,
      includeBranches: false,
    });
    const { sheetNames } = await openWorkbook(buffer);

    expect(sheetNames).not.toContain('By local');
    expect(counts.branches).toBe(0);
    expect(seen.some((sql) => sql.includes('FROM branches b'))).toBe(false);
    // The branch id is bound as a parameter, never interpolated into the SQL.
    expect(seen.some((sql) => sql.includes('branch_id = $'))).toBe(true);
  });
});
