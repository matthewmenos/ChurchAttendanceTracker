import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { PageHeader, StatCard } from '../../components/ui/display.jsx';
import { ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button, Field, Select } from '../../components/ui/forms.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { BarList, TrendChart } from '../../components/charts/Charts.jsx';
import { IconCircleCheck, IconChevronRight } from '../../components/ui/icons.jsx';
import { downloadCsv } from '../../utils/csv.js';
import { formatShortDate } from '../../utils/format.js';

const RANGES = {
  '30': 'Last 30 days',
  '90': 'Last 90 days',
  '365': 'Last 12 months',
  all: 'All time',
};

function rangeDates(key) {
  if (key === 'all') return { from: undefined, to: undefined };
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - Number(key));
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(from), to: fmt(to) };
}

export default function ReportsPage() {
  const [rangeKey, setRangeKey] = useState('90');
  const { from, to } = rangeDates(rangeKey);

  useEffect(() => {
    document.title = 'Reports — Church Attendance Tracker';
  }, []);

  const summaryQ = useFetch(() => api('/reports/summary', { params: { from, to } }), [rangeKey]);
  const data = summaryQ.data;

  const trendPoints = useMemo(
    () => ((data && data.byService) || []).map((s) => ({ label: formatShortDate(s.service_date), value: s.present })),
    [data]
  );

  if (summaryQ.loading) return <div className='container'><LoadingBlock label='Crunching numbers…' /></div>;
  if (summaryQ.error) return <div className='container'><ErrorState error={summaryQ.error} onRetry={summaryQ.reload} /></div>;

  const totals = (data && data.totals) || { present: 0, absent: 0, excused: 0 };
  const byService = (data && data.byService) || [];
  const byGroup = (data && data.byGroup) || [];
  const repeatAbsentees = (data && data.repeatAbsentees) || [];
  const byUsher = (data && data.byUsher) || [];

  const exportAttendance = async () => {
    const rows = [];
    let page = 1;
    for (;;) {
      const res = await api('/attendance', { params: { from, to, page, pageSize: 1000 } });
      rows.push(...res.items);
      if (rows.length >= res.total || res.items.length === 0) break;
      page += 1;
    }
    downloadCsv(
      `attendance-${from || 'all'}-to-${to || 'now'}.csv`,
      ['Date', 'Service', 'Member', 'Group', 'Status', 'Notes', 'Recorded by', 'Recorded at'],
      rows.map((r) => [r.service_date, r.service_name, r.member_name, r.group_name || '', r.status, r.notes || '', r.recorded_by_name || '', r.recorded_at])
    );
  };

  const exportMembers = async () => {
    const res = await api('/members', { params: { pageSize: 1000 } });
    downloadCsv(
      'members.csv',
      ['Name', 'Email', 'Phone', 'Gender', 'Group', 'Status', 'Last attended', 'Consecutive absences'],
      res.items.map((m) => [m.full_name, m.email || '', m.phone || '', m.gender || '', m.group_name || '', m.status, m.last_attended || '', m.consecutive_absences])
    );
  };

  return (
    <div className='container wide'>
      <PageHeader
        title='Reports'
        subtitle='Trends, group breakdowns and follow-up candidates.'
        actions={
          <>
            <Button variant='secondary' size='sm' onClick={exportMembers}>Export members CSV</Button>
            <Button size='sm' onClick={exportAttendance}>Export attendance CSV</Button>
          </>
        }
      />

      <div className='filter-bar card pad'>
        <Field label='Date range' id='rep-range' className='filter-field'>
          <Select id='rep-range' value={rangeKey} onChange={(e) => setRangeKey(e.target.value)}>
            {Object.entries(RANGES).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </Select>
        </Field>
        {(data && data.from) && <span className='muted small self-end'>{data.from} <IconChevronRight size={12} style={{ verticalAlign: '-2px' }} /> {data.to}</span>}
      </div>

      <section className='stat-grid stat-grid-4' aria-label='Totals'>
        <StatCard tone='green' label='Present' value={String(totals.present)} sub={`${totals.present_male || 0} male · ${totals.present_female || 0} female`} />
        <StatCard tone='red' label='Absent' value={String(totals.absent)} sub='member records' />
        <StatCard tone='blue' label='Excused' value={String(totals.excused)} sub='member records' />
        <StatCard tone='yellow' label='Services in range' value={String(byService.length)} />
      </section>

      <section className='card pad' aria-label='Trend over time'>
        <h2 className='card-title'>Attendance over time (present counts)</h2>
        <TrendChart points={trendPoints} height={200} />
      </section>

      <section className='card' aria-label='Attendance by service'>
        <h2 className='card-title pad-inline'>By service</h2>
        {byService.length === 0 ? (
          <p className='muted pad-inline'>No services in this range.</p>
        ) : (
          <Table
            caption='Attendance by service'
            rows={[...byService].reverse()}
            getRowKey={(r) => r.id}
            columns={[
              { key: 'service_date', label: 'Date', render: (r) => formatShortDate(r.service_date) },
              { key: 'service_name', label: 'Service', render: (r) => <Link to={`/admin/services/${r.id}`}>{r.service_name}</Link> },
              { key: 'present', label: 'Present', className: 'num' },
              { key: 'present_male', label: 'Male', className: 'num', render: (r) => String(r.present_male ?? 0) },
              { key: 'present_female', label: 'Female', className: 'num', render: (r) => String(r.present_female ?? 0) },
              { key: 'absent', label: 'Absent', className: 'num' },
              { key: 'excused', label: 'Excused', className: 'num' },
              { key: 'total_headcount', label: 'Headcount', className: 'num' },
            ]}
          />
        )}
      </section>

      <div className='grid-2'>
        <section className='card pad' aria-label='Attendance by group'>
          <h2 className='card-title'>By group</h2>
          <BarList
            items={byGroup.map((g) => ({
              label: g.name,
              value: g.present_members,
              extra: `${g.present_members}/${g.active_members} present`,
            }))}
          />
          <p className='muted small'>Shows distinct active members with at least one present record.</p>
        </section>

        <section className='card' aria-label='Records by usher'>
          <h2 className='card-title pad-inline'>By usher</h2>
          {byUsher.length === 0 ? (
            <p className='muted pad-inline'>No usher accounts yet.</p>
          ) : (
            <Table
              caption='Attendance records created by each usher'
              rows={byUsher}
              getRowKey={(r) => r.id}
              columns={[
                { key: 'name', label: 'Usher' },
                { key: 'records', label: 'Records', className: 'num' },
                { key: 'present', label: 'Present', className: 'num' },
                { key: 'absent', label: 'Absent', className: 'num' },
                { key: 'excused', label: 'Excused', className: 'num' },
              ]}
            />
          )}
        </section>
      </div>

      <section className='card' aria-label='Members with repeated absences'>
        <h2 className='card-title pad-inline'>Repeated absences — consider following up</h2>
        {repeatAbsentees.length === 0 ? (
          <p className='muted pad-inline'>
            <IconCircleCheck size={18} style={{ color: 'var(--green-600)' }} />{' '}
            Nobody currently meets the repeat-absence threshold.
          </p>
        ) : (
          <Table
            caption='Active members with repeated absences'
            rows={repeatAbsentees}
            getRowKey={(r) => r.id}
            columns={[
              { key: 'full_name', label: 'Member', render: (r) => <Link to={`/admin/members/${r.id}`} className='row-title'>{r.full_name}</Link> },
              { key: 'group_name', label: 'Group', render: (r) => r.group_name || '—' },
              { key: 'consecutive_absences', label: 'Streak', className: 'num' },
              { key: 'absences_in_range', label: 'Absences in range', className: 'num' },
              { key: 'last_attended', label: 'Last attended', render: (r) => (r.last_attended ? formatShortDate(r.last_attended) : 'Never') },
            ]}
          />
        )}
      </section>
    </div>
  );
}