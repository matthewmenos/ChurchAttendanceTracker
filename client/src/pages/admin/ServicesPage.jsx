import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
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

export default function ServicesPage() {
  const toast = useToast();
  const [tab, setTab] = useState('upcoming');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = 'Services — Church Attendance Tracker';
  }, []);

  const locationsQ = useFetch(() => api('/locations'), []);
  const listQ = useFetch(() => api('/services', { params: { pageSize: 100 } }), []);
  const all = (listQ.data && listQ.data.items) || [];
  const shown = tab === 'all' ? all : tab === 'upcoming' ? all.filter((s) => s.upcoming) : all.filter((s) => !s.upcoming);

  const openCreate = () => {
    setEditing(null);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (service) => {
    setEditing(service);
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
      totalHeadcount: form.get('totalHeadcount') === '' ? 0 : Number(form.get('totalHeadcount')),
      notes: form.get('notes'),
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
        subtitle='Plan services and keep the headcount up to date.'
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
              { key: 'service_name', label: 'Service', render: (r) => <Link to={`/admin/services/${r.id}`} className='row-title'>{r.service_name}</Link> },
              { key: 'start_time', label: 'Time', render: (r) => (r.start_time ? formatTime(r.start_time) : '—') },
              { key: 'location_name', label: 'Location', render: (r) => r.location_name || '—' },
              { key: 'total_headcount', label: 'Headcount', className: 'num' },
              { key: 'present', label: 'Attendance', render: (r) => (<span><Badge variant={r.marked > 0 ? 'info' : 'neutral'}>{r.present} marked</Badge>{r.attendance_closed ? <Badge variant='high'>Closed</Badge> : null}</span>) },
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
          <Field label='Service name' id='sv-name' required>
            <Input id='sv-name' name='serviceName' defaultValue={editing ? editing.service_name : ''} placeholder='e.g. Sunday Worship Service' required maxLength={120} />
          </Field>
          <Field label='Location' id='sv-location'>
            <Select id='sv-location' name='locationId' defaultValue={editing && editing.location_id ? String(editing.location_id) : ''}>
              <option value=''>No location</option>
              {((locationsQ.data && locationsQ.data.items) || []).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </Field>
          <Field label='Total headcount' id='sv-headcount' hint='Everyone present, including visitors.'>
            <Input id='sv-headcount' name='totalHeadcount' type='number' min={0} defaultValue={editing ? editing.total_headcount : 0} />
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