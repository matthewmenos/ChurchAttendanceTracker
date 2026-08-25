import { useEffect, useState } from 'react';
import useFetch from '../../hooks/useFetch.js';
import useDebounce from '../../hooks/useDebounce.js';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Badge, PageHeader, StatCard } from '../../components/ui/display.jsx';
import { Alert, EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/forms.jsx';
import { ConfirmDialog, Modal } from '../../components/ui/Modal.jsx';
import { Pagination, Table } from '../../components/ui/Table.jsx';
import { formatShortDate, formatDate } from '../../utils/format.js';
import { IconUsers } from '../../components/ui/icons.jsx';

const STATUSES = [['new', 'New'], ['contacted', 'Contacted'], ['visited', 'Visited'], ['joined', 'Joined'], ['lost', 'Lost']];
const STATUS_VARIANT = { new: 'info', contacted: 'neutral', visited: 'info', joined: 'ok', lost: 'high' };
const statusLabel = (k) => (STATUSES.find(([x]) => x === k) || [k, k])[1];

export default function VisitorsPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [convertTarget, setConvertTarget] = useState(null);
  const [converting, setConverting] = useState(false);

  const listQ = useFetch(
    () => api('/visitors', { params: { search: debounced || undefined, followupStatus: status || undefined, page, pageSize: 20 } }),
    [debounced, status, page]
  );
  const statsQ = useFetch(() => api('/visitors/stats'), []);
  const items = (listQ.data && listQ.data.items) || [];
  const total = (listQ.data && listQ.data.total) || 0;
  const stats = (statsQ.data && statsQ.data.items) || [];

  useEffect(() => { document.title = 'Visitors — Church Attendance Tracker'; }, []);

  const openEdit = (v) => { setEditing(v); setFormError(''); setFormOpen(true); };

  const saveVisitor = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    setSaving(true); setFormError('');
    try {
      await api(`/visitors/${editing.id}`, {
        method: 'PUT',
        body: {
          fullName: form.get('fullName'), gender: form.get('gender') || null,
          phone: form.get('phone') || null, email: form.get('email') || null,
          ageGroup: form.get('ageGroup') || null, homeArea: form.get('homeArea') || null,
          invitedBy: form.get('invitedBy') || null, prayerRequest: form.get('prayerRequest') || null,
          followupStatus: form.get('followupStatus'), assignedTo: form.get('assignedTo') || null,
          notes: form.get('notes') || null,
        },
      });
      toast('Visitor updated.');
      setFormOpen(false);
      await Promise.all([listQ.reload(), statsQ.reload()]);
    } catch (err) { setFormError(err.message || 'Could not save this visitor.'); }
    finally { setSaving(false); }
  };

  const doConvert = async () => {
    if (!convertTarget) return;
    setConverting(true);
    try {
      const res = await api(`/visitors/${convertTarget.id}/convert`, { method: 'POST' });
      toast(res.alreadyConverted ? 'This visitor was already converted to a member.' : `${convertTarget.full_name} is now a member.`);
      setConvertTarget(null);
      await Promise.all([listQ.reload(), statsQ.reload()]);
    } catch (err) { toast(err.message || 'Could not convert this visitor.'); }
    finally { setConverting(false); }
  };

  const totals = stats.reduce((acc, s) => ({
    first_time: acc.first_time + Number(s.first_time || 0),
    returning: acc.returning + Number(s.returning || 0),
    converted: acc.converted + Number(s.converted || 0),
  }), { first_time: 0, returning: 0, converted: 0 });

  /* __VIS_LOGIC__ */
  return (
    <div className='container wide'>
      <PageHeader title='Visitors' subtitle='Track guests, follow up, and welcome them into membership.' />
      <section className='stat-grid stat-grid-4' aria-label='Visitor totals'>
        <StatCard tone='blue' label='Total visitors' value={String(stats.reduce((a, s) => a + Number(s.total_visitors || 0), 0))} sub='across all services' />
        <StatCard tone='green' label='First time' value={String(totals.first_time)} />
        <StatCard tone='info' label='Returning' value={String(totals.returning)} />
        <StatCard tone='yellow' label='Joined as members' value={String(totals.converted)} />
      </section>

      <div className='filter-bar card pad'>
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder='Search name or phone…' aria-label='Search visitors' className='filter-field' />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label='Filter by follow-up status' className='select-fit'>
          <option value=''>All statuses</option>
          {STATUSES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </Select>
      </div>

      {listQ.loading && <LoadingBlock />}
      {listQ.error && <ErrorState error={listQ.error} onRetry={listQ.reload} />}
      {!listQ.loading && !listQ.error && items.length === 0 && (
        <EmptyState icon={<IconUsers size={44} />} title='No visitors found' message='Visitors captured by ushers during services appear here.' />
      )}

      {items.length > 0 && (
        <div className='card'>
          <Table
            caption='Visitors'
            rows={items}
            getRowKey={(r) => r.id}
            columns={[
              { key: 'full_name', label: 'Name', render: (r) => <strong>{r.full_name}</strong> },
              { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' },
              { key: 'visits', label: 'Visits', render: (r) => (r.visit_count > 1 ? <Badge variant='info'>{r.visit_count}× returning</Badge> : <Badge variant='neutral'>First time</Badge>) },
              { key: 'gender', label: 'Gender', render: (r) => (r.gender ? (r.gender === 'male' ? 'Male' : 'Female') : '—') },
              { key: 'service', label: 'First service', render: (r) => (r.service_date ? `${r.service_name} · ${formatShortDate(r.service_date)}` : '—') },
              { key: 'followup_status', label: 'Status', render: (r) => <Badge variant={STATUS_VARIANT[r.followup_status] || 'neutral'}>{statusLabel(r.followup_status)}</Badge> },
              { key: 'assigned_to', label: 'Assigned to', render: (r) => r.assigned_to || '—' },
              {
                key: 'actions',
                label: 'Actions',
                render: (r) => (
                  <span className='row-actions'>
                    <button type='button' className='btn btn-ghost btn-sm' onClick={() => openEdit(r)}>Edit</button>
                    {!r.converted_member_id && (
                      <button type='button' className='btn btn-secondary btn-sm' onClick={() => setConvertTarget(r)}>Convert to member</button>
                    )}
                    {r.converted_member_id && <Badge variant='ok'>Member</Badge>}
                  </span>
                ),
              },
            ]}
          />
          <Pagination page={page} pageSize={20} total={total} onPage={setPage} />
        </div>
      )}

      <Modal open={formOpen} title={editing ? `Edit — ${editing.full_name}` : 'Edit visitor'} onClose={() => setFormOpen(false)} width='520px'>
        <form onSubmit={saveVisitor} noValidate>
          {formError && <Alert variant='error'>{formError}</Alert>}
          <div className='field-row'>
            <Field label='Full name' id='v-name' required>
              <Input id='v-name' name='fullName' defaultValue={editing ? editing.full_name : ''} required maxLength={120} />
            </Field>
            <Field label='Phone' id='v-phone'>
              <Input id='v-phone' name='phone' defaultValue={editing ? editing.phone : ''} maxLength={40} />
            </Field>
          </div>
          <div className='field-row'>
            <Field label='Gender' id='v-gender'>
              <Select id='v-gender' name='gender' defaultValue={editing ? editing.gender || '' : ''}>
                <option value=''>Not specified</option>
                <option value='male'>Male</option>
                <option value='female'>Female</option>
              </Select>
            </Field>
            <Field label='Age group' id='v-age'>
              <Select id='v-age' name='ageGroup' defaultValue={editing ? editing.age_group || '' : ''}>
                <option value=''>Not specified</option>
                <option value='child'>Child</option>
                <option value='teen'>Teen</option>
                <option value='adult'>Adult</option>
              </Select>
            </Field>
          </div>
          <Field label='Email' id='v-email'>
            <Input id='v-email' name='email' type='email' defaultValue={editing ? editing.email : ''} maxLength={200} />
          </Field>
          <div className='field-row'>
            <Field label='Home area' id='v-area'>
              <Input id='v-area' name='homeArea' defaultValue={editing ? editing.home_area : ''} maxLength={120} />
            </Field>
            <Field label='Invited by' id='v-invited'>
              <Input id='v-invited' name='invitedBy' defaultValue={editing ? editing.invited_by : ''} maxLength={120} />
            </Field>
          </div>
          <Field label='Prayer request' id='v-prayer'>
            <Textarea id='v-prayer' name='prayerRequest' defaultValue={editing ? editing.prayer_request : ''} maxLength={1000} rows={2} />
          </Field>
          <div className='field-row'>
            <Field label='Follow-up status' id='v-status' required>
              <Select id='v-status' name='followupStatus' defaultValue={editing ? editing.followup_status : 'new'}>
                {STATUSES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </Select>
            </Field>
            <Field label='Assigned to' id='v-assigned'>
              <Input id='v-assigned' name='assignedTo' defaultValue={editing ? editing.assigned_to : ''} maxLength={120} placeholder='e.g. Pastoral Team' />
            </Field>
          </div>
          <Field label='Notes' id='v-notes'>
            <Textarea id='v-notes' name='notes' defaultValue={editing ? editing.notes : ''} maxLength={1000} rows={2} />
          </Field>
          {editing && (
            <p className='muted small'>First visited {editing.first_visit_date ? formatDate(editing.first_visit_date) : '—'} · {editing.visit_count} visit(s) · recorded by {editing.created_by_name || '—'}.</p>
          )}
          <div className='modal-actions'>
            <Button variant='secondary' type='button' onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type='submit' loading={saving}>Save visitor</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!convertTarget}
        title='Convert to member?'
        message={`${convertTarget ? convertTarget.full_name : ''} will be added to the members list with their name, phone, email and gender. You can finish their profile in the Members area.`}
        confirmLabel='Convert to member'
        loading={converting}
        onConfirm={doConvert}
        onCancel={() => setConvertTarget(null)}
      />
    </div>
  );
}