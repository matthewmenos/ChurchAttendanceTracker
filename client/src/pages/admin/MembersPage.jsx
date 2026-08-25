import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import useFetch from '../../hooks/useFetch.js';
import useDebounce from '../../hooks/useDebounce.js';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Avatar, Badge, PageHeader } from '../../components/ui/display.jsx';
import { Alert, EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/forms.jsx';
import { Modal, ConfirmDialog } from '../../components/ui/Modal.jsx';
import SearchInput from '../../components/ui/SearchInput.jsx';
import { Pagination, Table } from '../../components/ui/Table.jsx';
import { formatShortDate } from '../../utils/format.js';
import { IconUsers, IconTriangleAlert } from '../../components/ui/icons.jsx';

const EMPTY_FORM = { fullName: '', email: '', phone: '', groupId: '', status: 'active', notes: '' };

export default function MembersPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [status, setStatus] = useState('all');
  const [groupId, setGroupId] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null); // member or null for create
  const [confirmTarget, setConfirmTarget] = useState(null); // member for activate/deactivate
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    document.title = 'Members — Church Attendance Tracker';
  }, []);

  const groupsQ = useFetch(() => api('/groups'), []);
  const listQ = useFetch(
    () => api('/members', { params: { search: debounced, status, groupId, page, pageSize: 12 } }),
    [debounced, status, groupId, page]
  );
  const items = (listQ.data && listQ.data.items) || [];
  const total = (listQ.data && listQ.data.total) || 0;

  const openCreate = () => {
    setEditing(null);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (member) => {
    setEditing(member);
    setFormError('');
    setFormOpen(true);
  };

  const saveMember = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      fullName: form.get('fullName'),
      email: form.get('email'),
      phone: form.get('phone'),
      groupId: form.get('groupId') || null,
      status: form.get('status') || undefined,
      notes: form.get('notes'),
    };
    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        await api(`/members/${editing.id}`, { method: 'PUT', body: payload });
        toast('Member updated.');
      } else {
        await api('/members', { method: 'POST', body: { ...payload, status: payload.status || 'active' } });
        toast('Member added.');
      }
      setFormOpen(false);
      await listQ.reload();
    } catch (err) {
      setFormError(err.message || 'Could not save this member.');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async () => {
    if (!confirmTarget) return;
    setToggling(true);
    try {
      const next = confirmTarget.status === 'active' ? 'inactive' : 'active';
      await api(`/members/${confirmTarget.id}/status`, { method: 'PATCH', body: { status: next } });
      toast(next === 'active' ? 'Member reactivated.' : 'Member deactivated.');
      setConfirmTarget(null);
      await listQ.reload();
    } catch (err) {
      toast(err.message || 'Could not change status.');
      setConfirmTarget(null);
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className='container wide'>
      <PageHeader
        title='Members'
        subtitle='Add, edit and manage everyone in the congregation.'
        actions={<Button onClick={openCreate}>+ Add member</Button>}
      />

      <div className='filter-bar card pad'>
        <SearchInput placeholder='Search name, email or phone…' onDebounce={(v) => { setSearch(v); setPage(1); }} ariaLabel='Search members' initialValue={search} />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label='Filter by status' className='select-fit'>
          <option value='all'>All statuses</option>
          <option value='active'>Active</option>
          <option value='inactive'>Inactive</option>
        </Select>
        <Select value={groupId} onChange={(e) => { setGroupId(e.target.value); setPage(1); }} aria-label='Filter by group' className='select-fit'>
          <option value=''>All groups</option>
          {((groupsQ.data && groupsQ.data.items) || []).map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </Select>
        {(search || status !== 'all' || groupId) ? (
          <button type='button' className='btn btn-ghost btn-sm' onClick={() => { setSearch(''); setStatus('all'); setGroupId(''); setPage(1); }}>
            Clear filters
          </button>
        ) : null}
      </div>

      {listQ.loading && <LoadingBlock label='Loading members…' />}
      {listQ.error && <ErrorState error={listQ.error} onRetry={listQ.reload} />}
      {!listQ.loading && !listQ.error && items.length === 0 && (
        <EmptyState icon={<IconUsers size={44} />} title='No members found' message='Try different filters, or add your first member.' action={<Button onClick={openCreate}>+ Add member</Button>} />
      )}

      {items.length > 0 && (
        <div className='card'>
          <Table
            caption='Church members'
            rows={items}
            getRowKey={(r) => r.id}
            columns={[
              {
                key: 'full_name',
                label: 'Member',
                render: (m) => (
                  <span className='cell-person'>
                    <Avatar name={m.full_name} size='sm' />
                    <span>
                      <Link to={`/admin/members/${m.id}`} className='row-title'>{m.full_name}</Link>
                      <span className='muted small block'>{m.email || 'No email'}</span>
                    </span>
                  </span>
                ),
              },
              { key: 'group_name', label: 'Group', render: (m) => m.group_name || '—' },
              { key: 'phone', label: 'Phone', render: (m) => m.phone || '—' },
              { key: 'status', label: 'Status', render: (m) => <Badge variant={m.status}>{m.status === 'active' ? 'Active' : 'Inactive'}</Badge> },
              { key: 'last_attended', label: 'Last attended', render: (m) => (m.last_attended ? formatShortDate(m.last_attended) : 'Never') },
              {
                key: 'consecutive_absences',
                label: 'Absences',
                className: 'num',
                render: (m) => (m.consecutive_absences >= 3 ? <Badge variant='high'>{m.consecutive_absences} <IconTriangleAlert size={11} /></Badge> : String(m.consecutive_absences)),
              },
              {
                key: 'actions',
                label: 'Actions',
                render: (m) => (
                  <span className='row-actions'>
                    <Link className='btn btn-ghost btn-sm' to={`/admin/members/${m.id}`}>View</Link>
                    <button type='button' className='btn btn-ghost btn-sm' onClick={() => openEdit(m)}>Edit</button>
                    <button
                      type='button'
                      className={'btn btn-sm ' + (m.status === 'active' ? 'btn-ghost-danger' : 'btn-ghost')}
                      onClick={() => setConfirmTarget(m)}
                    >
                      {m.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                  </span>
                ),
              },
            ]}
          />
          <Pagination page={page} pageSize={12} total={total} onPage={setPage} />
        </div>
      )}

      <Modal open={formOpen} title={editing ? `Edit — ${editing.full_name}` : 'Add a member'} onClose={() => setFormOpen(false)} width='520px'>
        <form onSubmit={saveMember} noValidate>
          {formError && <Alert variant='error'>{formError}</Alert>}
          <Field label='Full name' id='m-name' required>
            <Input id='m-name' name='fullName' defaultValue={editing ? editing.full_name : ''} required maxLength={120} autoComplete='off' />
          </Field>
          <div className='field-row'>
            <Field label='Email' id='m-email' hint='Optional'>
              <Input id='m-email' name='email' type='email' defaultValue={editing ? editing.email : ''} maxLength={200} />
            </Field>
            <Field label='Phone' id='m-phone' hint='Optional'>
              <Input id='m-phone' name='phone' defaultValue={editing ? editing.phone : ''} maxLength={40} />
            </Field>
          </div>
          <div className='field-row'>
            <Field label='Group' id='m-group'>
              <Select id='m-group' name='groupId' defaultValue={editing && editing.group_id ? String(editing.group_id) : ''}>
                <option value=''>No group</option>
                {((groupsQ.data && groupsQ.data.items) || []).map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </Select>
            </Field>
            <Field label='Status' id='m-status'>
              <Select id='m-status' name='status' defaultValue={editing ? editing.status : 'active'}>
                <option value='active'>Active</option>
                <option value='inactive'>Inactive</option>
              </Select>
            </Field>
          </div>
          <Field label='Notes' id='m-notes' hint='Optional pastoral notes.'>
            <Textarea id='m-notes' name='notes' defaultValue={editing ? editing.notes : ''} maxLength={1000} rows={3} />
          </Field>
          <div className='modal-actions'>
            <Button variant='secondary' type='button' onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type='submit' loading={saving}>{editing ? 'Save changes' : 'Add member'}</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        title={confirmTarget && confirmTarget.status === 'active' ? 'Deactivate member?' : 'Reactivate member?'}
        message={
          confirmTarget && confirmTarget.status === 'active'
            ? `${confirmTarget.full_name} will no longer appear in the attendance roster. Their history is kept.`
            : `${confirmTarget ? confirmTarget.full_name : ''} will appear in the roster again.`
        }
        confirmLabel={confirmTarget && confirmTarget.status === 'active' ? 'Deactivate' : 'Reactivate'}
        danger={!!(confirmTarget && confirmTarget.status === 'active')}
        loading={toggling}
        onConfirm={toggleStatus}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}