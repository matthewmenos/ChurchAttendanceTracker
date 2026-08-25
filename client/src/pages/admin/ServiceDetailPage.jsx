import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { Badge, PageHeader, StatCard, StatusBadge } from '../../components/ui/display.jsx';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button } from '../../components/ui/forms.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { formatDate, formatDateTime, formatTime } from '../../utils/format.js';
import { IconChevronLeft, IconFileText, IconPrinter } from '../../components/ui/icons.jsx';

export default function ServiceDetailPage() {
  const { id } = useParams();
  const detail = useFetch(() => api(`/services/${id}`), [id]);
  const attendance = useFetch(() => api(`/services/${id}/attendance`), [id]);

  useEffect(() => {
    document.title = 'Service — Church Attendance Tracker';
  }, []);

  if (detail.loading) return <div className='container'><LoadingBlock /></div>;
  if (detail.error) return <div className='container'><ErrorState error={detail.error} onRetry={detail.reload} /></div>;

  const service = (detail.data && detail.data.service) || {};
  const items = (attendance.data && attendance.data.items) || [];
  const totals = (attendance.data && attendance.data.totals)
    || { present: 0, absent: 0, excused: 0, marked: 0, present_male: 0, present_female: 0 };

  return (
    <div className='container wide'>
      <Link to='/admin/services' className='link-btn back-link no-print'><IconChevronLeft size={14} /> Back to services</Link>

      <PageHeader
        title={service.service_name}
        subtitle={`${formatDate(service.service_date)}${service.start_time ? ` · ${formatTime(service.start_time)}` : ''}${service.location_name ? ` · ${service.location_name}` : ''}`}
        actions={(
          <>
            <Button variant='secondary' onClick={() => window.print()}><IconPrinter size={16} /> Print report</Button>
            <Link className='btn btn-primary no-print' to={`/admin/attendance?service=${service.id}`}>Take / edit attendance</Link>
          </>
        )}
      />

      <section className='stat-grid stat-grid-4' aria-label='Attendance totals'>
        <StatCard tone='green' label='Present' value={String(totals.present)} sub={`${totals.present_male || 0} male · ${totals.present_female || 0} female`} />
        <StatCard tone='red' label='Absent' value={String(totals.absent)} sub={`${totals.absent_male || 0} male · ${totals.absent_female || 0} female`} />
        <StatCard tone='blue' label='Excused' value={String(totals.excused)} sub={`${totals.excused_male || 0} male · ${totals.excused_female || 0} female`} />
        <StatCard tone='yellow' label='Reported headcount' value={String(service.total_headcount ?? 0)} sub={`${totals.marked} members marked`} />
      </section>

      <section className='card' aria-label='Member attendance for this service'>
        <h2 className='card-title pad-inline'>Who was marked</h2>
        {attendance.loading && <LoadingBlock />}
        {attendance.error && <div className='pad-inline'><ErrorState error={attendance.error} onRetry={attendance.reload} /></div>}
        {!attendance.loading && !attendance.error && items.length === 0 && (
          <EmptyState icon={<IconFileText size={44} />} title='No attendance recorded yet' message='Use the button above to open this service in the attendance screen.' />
        )}
        {items.length > 0 && (
          <Table
            caption='Attendance entries for this service'
            rows={items}
            getRowKey={(r) => r.id}
            columns={[
              { key: 'member_name', label: 'Member', render: (r) => <Link to={`/admin/members/${r.member_id}`} className='row-title'>{r.member_name}</Link> },
              { key: 'gender', label: 'Gender', render: (r) => (r.gender ? (r.gender === 'male' ? 'Male' : 'Female') : '—') },
              { key: 'group_name', label: 'Group', render: (r) => r.group_name || '—' },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'notes', label: 'Notes', render: (r) => r.notes || '—' },
              { key: 'recorded_by_name', label: 'Recorded by' },
              { key: 'updated_at', label: 'Last change', render: (r) => formatDateTime(r.updated_at) },
            ]}
          />
        )}
      </section>

      {service.notes && (
        <section className='card pad'>
          <h2 className='card-title'>Service notes</h2>
          <p>{service.notes}</p>
          <Badge variant='neutral'>{service.upcoming ? 'Upcoming' : 'Past service'}</Badge>
        </section>
      )}
    </div>
  );
}