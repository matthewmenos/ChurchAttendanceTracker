import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Avatar, Badge, PageHeader, StatCard, StatusBadge } from '../../components/ui/display.jsx';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/forms.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Table } from '../../components/ui/Table.jsx';

import { formatDate, formatShortDate, formatDateTime } from '../../utils/format.js';
import { IconCalendar, IconChevronLeft, IconTriangleAlert } from '../../components/ui/icons.jsx';

export default function MemberDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const detail = useFetch(() => api(`/members/${id}`), [id]);
  const history = useFetch(() => api(`/members/${id}/attendance`), [id]);
  const followups = useFetch(() => api('/followups', { params: { status: 'all', memberId: id } }), [id]);

  const [fuOpen, setFuOpen] = useState(false);
  const [savingFu, setSavingFu] = useState(false);
  const [fuError, setFuError] = useState('');

  useEffect(() => {
    document.title = 'Member — Church Attendance Tracker';
  }, []);

  if (detail.loading) return <div className='container'><LoadingBlock /></div>;
  if (detail.error) return <div className='container'><ErrorState error={detail.error} onRetry={detail.reload} /></div>;

  const member = (detail.data && detail.data.member) || {};
  const summary = (history.data && history.data.summary) || { present: 0, absent: 0, excused: 0 };
  const items = (history.data && history.data.items) || [];
  const followItems = (followups.data && followups.data.items) || [];

  const addFollowUp = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    setSavingFu(true);
    setFuError('');
    try {
      await api('/followups', {
        method: 'POST',
        body: {
          memberId: Number(id),
          absentWeeks: form.get('absentWeeks') ? Number(form.get('absentWeeks')) : undefined,
          lastSeen: form.get('lastSeen') || undefined,
          reason: form.get('reason'),
          priority: form.get('priority') || undefined,
          assignedTo: form.get('assignedTo'),
        },
      });
      toast('Follow-up created.');
      setFuOpen(false);
      await Promise.all([followups.reload(), detail.reload()]);
    } catch (err) {
      setFuError(err.message || 'Could not save the follow-up.');
    } finally {
      setSavingFu(false);
    }
  };

  return (
    <div className='container wide'>
      <button type='button' className='link-btn back-link' onClick={() => navigate('/admin/members')}><IconChevronLeft size={14} /> Back to members</button>

      <section className='card pad member-hero'>
        <Avatar name={member.full_name} size='lg' />
        <div className='member-hero-main'>
          <h1>{member.full_name}</h1>
          <div className='badge-row'>
            <Badge variant={member.status}>{member.status === 'active' ? 'Active' : 'Inactive'}</Badge>
            {(member.groups || []).map((g) => <Badge key={g.id} variant='info'>{g.name}</Badge>)}
            {member.consecutive_absences >= 3 && <Badge variant='high'>{member.consecutive_absences} weeks absent <IconTriangleAlert size={11} /></Badge>}
          </div>
          <p className='muted'>
            {member.email || 'No email on file'} · {member.phone || 'No phone on file'}<br />
            {member.birthday ? <>Birthday: {formatDate(member.birthday)}<br /></> : null}
            Last attended: {member.last_attended ? formatDate(member.last_attended) : 'Never'}
          </p>
          {member.notes && <p className='member-notes'>{member.notes}</p>}
        </div>
        <div className='member-hero-actions'>
          <Button variant='secondary' onClick={() => navigate('/admin/members')}>Edit in list</Button>
          <Button onClick={() => setFuOpen(true)}>+ Follow-up plan</Button>
        </div>
      </section>

      <section className='stat-grid stat-grid-4' aria-label='Attendance summary'>
        <StatCard tone='green' label='Present' value={String(summary.present)} />
        <StatCard tone='red' label='Absent' value={String(summary.absent)} />
        <StatCard tone='blue' label='Excused' value={String(summary.excused)} />
        <StatCard tone='yellow' label='Consecutive absences' value={String(member.consecutive_absences ?? 0)} />
      </section>

      <div className='grid-2'>
        <section className='card' aria-label='Attendance history'>
          <h2 className='card-title pad-inline'>Attendance history</h2>
          {items.length === 0 ? (
            <EmptyState icon={<IconCalendar size={44} />} title='No attendance yet' message='This member has not been marked for any service.' />
          ) : (
            <Table
              caption='Attendance history for this member'
              rows={items}
              getRowKey={(r) => r.id}
              columns={[
                { key: 'service_date', label: 'Date', render: (r) => formatShortDate(r.service_date) },
                { key: 'service_name', label: 'Service' },
                { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                { key: 'notes', label: 'Notes', render: (r) => r.notes || '—' },
                { key: 'recorded_by_name', label: 'Recorded by', render: (r) => `${r.recorded_by_name || ''}${r.updated_by_name && r.updated_by_name !== r.recorded_by_name ? ` / ${r.updated_by_name}` : ''}` },
              ]}
            />
          )}
        </section>

        <section className='card' aria-label='Follow-up plans'>
          <div className='card-head-row pad-inline'>
            <h2 className='card-title'>Follow-ups</h2>
            <Button size='sm' onClick={() => setFuOpen(true)}>+ Add</Button>
          </div>
          {followItems.length === 0 ? (
            <p className='muted pad-inline'>No follow-up plans for this member.</p>
          ) : (
            <ul className='stack pad-inline'>
              {followItems.map((f) => (
                <li key={f.id} className='follow-item card-lite'>
                  <span><Badge variant={f.priority}>{f.priority.toUpperCase()}</Badge> <strong>{f.reason || 'Follow-up'}</strong></span>
                  <span className='muted small'>
                    {f.assigned_to ? `Assigned to ${f.assigned_to} · ` : ''}
                    {f.absent_weeks} wk absent · {f.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className='muted small pad-inline'>Created records show up on the Overview dashboard.</p>
        </section>
      </div>

      <Modal open={fuOpen} title={`New follow-up — ${member.full_name}`} onClose={() => setFuOpen(false)} width='480px'>
        <form onSubmit={addFollowUp} noValidate>
          {fuError && <Alert variant='error'>{fuError}</Alert>}
          <div className='field-row'>
            <Field label='Weeks absent' id='fu-weeks' hint={`Current streak: ${member.consecutive_absences ?? 0}`}>
              <Input id='fu-weeks' name='absentWeeks' type='number' min={0} defaultValue={member.consecutive_absences ?? 0} />
            </Field>
            <Field label='Last seen' id='fu-lastseen'>
              <Input id='fu-lastseen' name='lastSeen' type='date' defaultValue={member.last_attended || ''} />
            </Field>
          </div>
          <Field label='Reason' id='fu-reason' hint='Why do they need a visit or call?'>
            <Textarea id='fu-reason' name='reason' maxLength={300} rows={2} />
          </Field>
          <div className='field-row'>
            <Field label='Priority' id='fu-priority'>
              <Select id='fu-priority' name='priority' defaultValue='medium'>
                <option value='high'>High</option>
                <option value='medium'>Medium</option>
                <option value='low'>Low</option>
              </Select>
            </Field>
            <Field label='Assign to' id='fu-assigned' hint='e.g. Pastoral Team'>
              <Input id='fu-assigned' name='assignedTo' maxLength={120} />
            </Field>
          </div>
          <div className='modal-actions'>
            <Button variant='secondary' type='button' onClick={() => setFuOpen(false)}>Cancel</Button>
            <Button type='submit' loading={savingFu}>Create follow-up</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}