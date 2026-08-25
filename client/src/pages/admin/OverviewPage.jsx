import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { Badge, PageHeader, StatCard, StatusBadge } from '../../components/ui/display.jsx';
import { ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { TrendChart } from '../../components/charts/Charts.jsx';
import { IconCircleCheck } from '../../components/ui/icons.jsx';
import { formatDate, formatShortDate, timeAgo } from '../../utils/format.js';

export default function OverviewPage() {
  const { data, loading, error, reload } = useFetch(() => api('/reports/dashboard'), []);

  useEffect(() => {
    document.title = 'Overview — Church Attendance Tracker';
  }, []);

  if (loading) return <div className='container'><LoadingBlock label='Building your dashboard…' /></div>;
  if (error) return <div className='container'><ErrorState error={error} onRetry={reload} /></div>;

  const d = data || {};
  const latest = d.latestService;

  return (
    <div className='container'>
      <PageHeader title='Overview' subtitle='A quick picture of attendance health across the church.' />

      <section className='stat-grid' aria-label='Key numbers'>
        <StatCard
          tone='blue'
          label='Latest service'
          value={latest ? `${latest.totals.present} present` : '—'}
          sub={latest ? `${latest.service_name} · ${formatDate(latest.service_date)}` : 'No services yet'}
        />
        <StatCard
          tone='yellow'
          label='Avg recent attendance'
          value={d.avgRecentAttendance == null ? '—' : String(d.avgRecentAttendance)}
          sub='Average of last 4 services'
        />
        <StatCard tone='green' label='Active members' value={String(d.totalActiveMembers ?? 0)} sub={`${d.totalInactiveMembers ?? 0} inactive`} />
        <StatCard
          tone='red'
          label='Open follow-ups'
          value={String(d.openFollowUps ?? 0)}
          sub={`${(d.highPriorityFollowUps || []).length} high priority`}
        />
      </section>

      <section className='card pad' aria-label='Attendance trend'>
        <h2 className='card-title'>Recent attendance trend</h2>
        <TrendChart points={(d.trend || []).map((t) => ({ label: formatShortDate(t.service_date), value: t.present }))} />
      </section>

      <div className='grid-2'>
        <section className='card' aria-label='Recent services'>
          <div className='card-head-row'>
            <h2 className='card-title'>Recent services</h2>
            <Link to='/admin/services' className='link-btn'>View all</Link>
          </div>
          {(d.recentServices || []).length === 0 ? (
            <p className='muted pad-inline'>No services recorded yet.</p>
          ) : (
            <Table
              caption='Recent services with attendance totals'
              rows={d.recentServices}
              getRowKey={(r) => r.id}
              columns={[
                { key: 'service_name', label: 'Service', render: (r) => (<Link to={`/admin/services/${r.id}`}>{r.service_name}</Link>) },
                { key: 'service_date', label: 'Date', render: (r) => formatShortDate(r.service_date) },
                { key: 'present', label: 'Present', className: 'num' },
                { key: 'absent', label: 'Absent', className: 'num' },
                { key: 'excused', label: 'Excused', className: 'num' },
              ]}
            />
          )}
        </section>

        <section className='card' aria-label='High-priority follow-ups'>
          <div className='card-head-row'>
            <h2 className='card-title'>Needs follow-up</h2>
            <Link to='/admin/members' className='link-btn'>All members</Link>
          </div>
          {(d.highPriorityFollowUps || []).length === 0 ? (
            <p className='muted pad-inline'>
              <IconCircleCheck size={18} style={{ color: 'var(--green-600)', verticalAlign: '-3px' }} />{' '}
              No high-priority follow-ups right now.
            </p>
          ) : (
            <ul className='follow-list'>
              {d.highPriorityFollowUps.map((f) => (
                <li key={f.id}>
                  <Link to={`/admin/members/${f.member_id}`} className='follow-item'>
                    <span><strong>{f.member_name}</strong>{f.group_name ? ` · ${f.group_name}` : ''}</span>
                    <span className='follow-meta'>
                      <Badge variant='high'>{f.absent_weeks} wk absent</Badge>
                      {f.assigned_to && <span className='muted small'>{f.assigned_to}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className='card' aria-label='Latest attendance records'>
        <div className='card-head-row'>
          <h2 className='card-title'>Latest records</h2>
          <Link to='/admin/reports' className='link-btn'>Reports</Link>
        </div>
        {(d.latestRecords || []).length === 0 ? (
          <p className='muted pad-inline'>Nothing recorded yet.</p>
        ) : (
          <Table
            caption='Most recently updated attendance records'
            rows={d.latestRecords}
            getRowKey={(r) => r.id}
            columns={[
              { key: 'member_name', label: 'Member', render: (r) => <Link to={`/admin/members/${r.member_id}`}>{r.member_name}</Link> },
              { key: 'service_name', label: 'Service', render: (r) => `${r.service_name} · ${formatShortDate(r.service_date)}` },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'recorded_by_name', label: 'Recorded by' },
              { key: 'updated_at', label: 'When', render: (r) => timeAgo(r.updated_at) },
            ]}
          />
        )}
      </section>
    </div>
  );
}