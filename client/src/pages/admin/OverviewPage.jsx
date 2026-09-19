import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Badge, PageHeader, StatCard, StatusBadge } from '../../components/ui/display.jsx';
import { ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { TrendChart } from '../../components/charts/Charts.jsx';
import { IconCircleCheck } from '../../components/ui/icons.jsx';
import { formatDate, formatShortDate, timeAgo } from '../../utils/format.js';

function LocalComparison() {
  const { data, loading, error, reload } = useFetch(() => api('/reports/locals'), []);
  if (loading) return <section className='card pad'><LoadingBlock label='Comparing locals…' /></section>;
  if (error) return <section className='card pad'><ErrorState error={error} onRetry={reload} /></section>;

  const rows = (data && data.locals) || [];
  const totals = (data && data.totals) || null;
  return (
    <section className='card' aria-label='Local comparison'>
      <div className='card-head-row'>
        <h2 className='card-title'>Attendance by local</h2>
        <span className='muted small'>Last 90 days</span>
      </div>
      {totals && (
        <p className='muted small pad-inline'>
          <strong>{totals.total_active_members}</strong> active members across{' '}
          <strong>{totals.local_count}</strong> locals
          {totals.unassigned_members > 0 && (
            <> · <strong>{totals.unassigned_members}</strong> member{totals.unassigned_members === 1 ? '' : 's'} not assigned to any local</>
          )}
        </p>
      )}
      {rows.length === 0 ? (
        <p className='muted pad-inline'>No active locals yet.</p>
      ) : (
        <Table
          caption='Attendance comparison across locals'
          rows={rows}
          getRowKey={(r) => r.id}
          columns={[
            { key: 'name', label: 'Local' },
            { key: 'active_members', label: 'Members', className: 'num' },
            { key: 'services', label: 'Services', className: 'num' },
            { key: 'present', label: 'Present', className: 'num' },
            {
              key: 'avg_present_per_service',
              label: 'Avg / service',
              className: 'num',
              render: (r) => (r.avg_present_per_service == null ? '—' : String(r.avg_present_per_service)),
            },
            { key: 'open_follow_ups', label: 'Follow-ups', className: 'num' },
          ]}
        />
      )}
    </section>
  );
}

export default function OverviewPage() {
  const { user, currentLocalId } = useAuth();
  const isDistrictAdmin = !!user && user.role === 'district_admin';
  const { data, loading, error, reload } = useFetch(
    () => api("/reports/dashboard", { params: currentLocalId ? { localId: currentLocalId } : {} }),
    [currentLocalId]
  );

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

      {isDistrictAdmin && <LocalComparison />}

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
