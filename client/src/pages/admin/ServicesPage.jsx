import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Badge, PageHeader, Tabs } from '../../components/ui/display.jsx';
import { Alert, EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/forms.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { formatDate, formatShortDate, formatTime } from '../../utils/format.js';
import { IconCalendar } from '../../components/ui/icons.jsx';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO timestamp -> value usable by <input type='datetime-local'> in local time. */
function toLocalDT(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ServicesPage() {
  const toast = useToast();
  const { user, branches, currentBranchId } = useAuth();
  const isDistrict = !!user && user.role === 'district_admin';
  const [tab, setTab] = useState('upcoming');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  // Joint checkbox state drives the branch field: a joint service belongs to
  // no branch, so the branch picker is disabled while it is ticked.
  const [jointChecked, setJointChecked] = useState(false);

  useEffect(() => {
    document.title = 'Services — Church Attendance Tracker';
  }, []);

  const locationsQ = useFetch(() => api('/locations'), []);
  const listQ = useFetch(() => api('/services', { params: { pageSize: 100 } }), []);
  const all = (listQ.data && listQ.data.items) || [];
  const shown = tab === 'all' ? all : tab === 'upcoming' ? all.filter((s) => s.upcoming) : all.filter((s) => !s.upcoming);

  const openCreate = () => {
    setEditing(null);
    setJointChecked(false);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (service) => {
    setEditing(service);
    setJointChecked(!!(service && service.all_branches));
    setFormError('');
    setFormOpen(true);
  };

  const saveService = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      serviceDate: form.get('serviceDate'),
      serviceName: form.get('serviceName'),
      startTime: form.get('startTime'),
      locationId: form.get('locationId') ? Number(form.get('locationId')) : null,
      attendanceCloseTime: form.get('attendanceCloseTime') || null,
      notes: form.get('notes'),
      // Joint services belong to no branch — the server clears branch_id;
      // regular district-admin services carry the picked branch.
      branchId: isDistrict ? (jointChecked ? null : (form.get('branchId') ? Number(form.get('branchId')) : undefined)) : undefined,
      allBranches: isDistrict ? jointChecked : undefined,
      // Manual walk-in visitor count; total present = members present + this.
      visitorHeadcount: form.get('visitorHeadcount') === '' ? 0 : Number(form.get('visitorHeadcount')) || 0,
    };
    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        await api(`/services/${editing.id}`, { method: 'PUT', body: payload });
        toast('Service updated.');
      } else {
        await api('/services', { method: 'POST', body: payload });
        toast('Service created.');
      }
      setFormOpen(false);
      await listQ.reload();
    } catch (err) {
      setFormError(err.message || 'Could not save this service.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='container wide'>
      <PageHeader
        title='Services'
        subtitle='Total present counts members marked present plus walk-in visitors and updates automatically.'
        actions={<Button onClick={openCreate}>+ New service</Button>}
      />

      <Tabs
        ariaLabel='Filter services'
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'upcoming', label: `Upcoming (${all.filter((s) => s.upcoming).length})` },
          { key: 'past', label: `Past (${all.filter((s) => !s.upcoming).length})` },
          { key: 'all', label: `All (${all.length})` },
        ]}
      />

      {listQ.loading && <LoadingBlock label='Loading services…' />}
      {listQ.error && <ErrorState error={listQ.error} onRetry={listQ.reload} />}
      {!listQ.loading && !listQ.error && shown.length === 0 && (
        <EmptyState icon={<IconCalendar size={44} />} title={tab === 'upcoming' ? 'No upcoming services' : 'No services here yet'} message='Create one to start recording attendance.' action={<Button onClick={openCreate}>+ New service</Button>} />
      )}

      {shown.length > 0 && (
        <div className='card'>
          <Table
            caption='Church services'
            rows={shown}
            getRowKey={(r) => r.id}
            columns={[
              { key: 'service_date', label: 'Date', render: (r) => (<span><strong>{formatShortDate(r.service_date)}</strong><span className='muted small block'>{formatDate(r.service_date).split(', ').pop()}</span></span>) },
              { key: 'service_name', label: 'Service', render: (r) => (<span><Link to={`/admin/services/${r.id}`} className='row-title'>{r.service_name}</Link>{r.all_branches ? <span> <Badge variant='info'>All locals</Badge></span> : null}</span>) },
              { key: 'start_time', label: 'Time', render: (r) => (r.start_time ? formatTime(r.start_time) : '—') },
              { key: 'location_name', label: 'Location', render: (r) => r.location_name || '—' },
              { key: 'total_present', label: 'Total present', className: 'num', render: (r) => String(r.total_present ?? r.present ?? 0) },
              { key: 'marked', label: 'Attendance', render: (r) => (<span><Badge variant={r.marked > 0 ? 'info' : 'neutral'}>{r.present} marked</Badge>{r.marking_closed ? <Badge variant='high'>Closed</Badge> : null}</span>) },
              {
                key: 'actions',
                label: 'Actions',
                render: (r) => (
                  <span className='row-actions'>
                    <Link className='btn btn-ghost btn-sm' to={`/admin/services/${r.id}`}>View</Link>
                    <button type='button' className='btn btn-ghost btn-sm' onClick={() => openEdit(r)}>Edit</button>
                    <Link className='btn btn-secondary btn-sm' to={`/admin/attendance?service=${r.id}`}>Attendance</Link>
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}

      <Modal open={formOpen} title={editing ? `Edit — ${editing.service_name}` : 'New service'} onClose={() => setFormOpen(false)} width='500px'>
        <form onSubmit={saveService} noValidate>
          {formError && <Alert variant='error'>{formError}</Alert>}
          <div className='field-row'>
            <Field label='Date' id='sv-date' required>
              <Input id='sv-date' name='serviceDate' type='date' defaultValue={editing ? String(editing.service_date).slice(0, 10) : todayStr()} required />
            </Field>
            <Field label='Start time' id='sv-time'>
              <Input id='sv-time' name='startTime' type='time' defaultValue={editing && editing.start_time ? String(editing.start_time).slice(0, 5) : '09:30'} />
            </Field>
          </div>
          <Field
            label='Attendance close time'
            id='sv-close'
            hint={
              editing && editing.attendance_closed
                ? 'Marking is already closed for this service.'
                : 'After this moment attendance marking locks automatically. Leave empty for no limit.'
            }
          >
            <Input
              id='sv-close'
              name='attendanceCloseTime'
              type='datetime-local'
              defaultValue={toLocalDT(editing && (editing.attendance_close_time || null))}
            />
          </Field>
          <Field label='Service name' id='sv-name' required>
            <Input id='sv-name' name='serviceName' defaultValue={editing ? editing.service_name : ''} placeholder='e.g. Sunday Worship Service' required maxLength={120} />
          </Field>
          {isDistrict && (
            <Field
              label='Local'
              id='sv-branch'
              required={!jointChecked && !editing}
              hint={jointChecked ? 'Joint services belong to no local — the picker is disabled.' : (editing ? 'You can move this service to another local.' : 'Every service belongs to a local.')}
            >
              <Select
                id='sv-branch'
                name='branchId'
                required={!jointChecked && !editing}
                disabled={jointChecked}
                defaultValue={editing && editing.branch_id ? String(editing.branch_id) : (currentBranchId ? String(currentBranchId) : '')}
              >
                <option value=''>Choose a local…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </Field>
          )}
          {isDistrict && (
            <Field
              label='Joint service'
              id='sv-all-branches'
              hint='Tick when all locals gather (e.g. combined service). The service then belongs to no local — ushers of every local can record attendance, and the roster includes every local’s members.'
            >
              <label className='checkbox' style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  id='sv-all-branches'
                  name='allBranches'
                  type='checkbox'
                  checked={jointChecked}
                  onChange={(e) => setJointChecked(e.target.checked)}
                />
                <span>All locals gather for this service</span>
              </label>
            </Field>
          )}
          <Field label='Location' id='sv-location'>
            <Select id='sv-location' name='locationId' defaultValue={editing && editing.location_id ? String(editing.location_id) : ''}>
              <option value=''>No location</option>
              {((locationsQ.data && locationsQ.data.items) || []).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </Field>
          <Field label='Total headcount' id='sv-headcount' hint='Read-only: members marked present plus walk-in visitors. It updates automatically.'>
            <Input
              id='sv-headcount'
              name='totalHeadcount'
              type='number'
              min={0}
              value={String(
                editing
                  ? (editing.total_present ?? ((editing.present ?? 0) + (editing.visitor_headcount ?? 0)))
                  : 0
              )}
              readOnly
              disabled
              aria-readonly='true'
            />
          </Field>
          <Field label='Visitors (walk-in)' id='sv-visitors' hint='Count of walk-in visitors, added to the total headcount. Members are counted automatically from attendance.'>
            <Input
              id='sv-visitors'
              name='visitorHeadcount'
              type='number'
              min={0}
              step={1}
              defaultValue={editing ? (editing.visitor_headcount ?? 0) : 0}
            />
          </Field>
          <Field label='Notes' id='sv-notes'>
            <Textarea id='sv-notes' name='notes' rows={2} maxLength={500} defaultValue={editing ? editing.notes : ''} />
          </Field>
          <div className='modal-actions'>
            <Button variant='secondary' type='button' onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type='submit' loading={saving}>{editing ? 'Save changes' : 'Create service'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}