import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useFetch from '../../hooks/useFetch.js';
import useDebounce from '../../hooks/useDebounce.js';
import useDuplicateCheck from '../../hooks/useDuplicateCheck.js';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Avatar, Badge, PageHeader } from '../../components/ui/display.jsx';
import { Alert, EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/forms.jsx';
import { Modal, ConfirmDialog } from '../../components/ui/Modal.jsx';
import SearchInput from '../../components/ui/SearchInput.jsx';
import { Pagination } from '../../components/ui/Table.jsx';
import { formatShortDate } from '../../utils/format.js';
import { IconUsers, IconTriangleAlert, IconChevronDown } from '../../components/ui/icons.jsx';

const EMPTY_FORM = { fullName: '', email: '', phone: '', groupIds: [], birthday: '', gender: '', membershipType: '', maritalStatus: '', profession: '', residence: '', status: 'active', notes: '' };

function MemberCard({ member: m, expanded, onToggle, onEdit, onToggleStatus, onTransfer, canTransfer }) {
  const genderLabel = m.gender === 'male' ? 'Male' : m.gender === 'female' ? 'Female' : null;
  const membershipLabel = m.membership_type === 'new_convert' ? 'New convert' : m.membership_type === 'existing' ? 'Existing' : null;
  const maritalLabel = m.marital_status ? ({ single: 'Single', married: 'Married', divorced: 'Divorced', widowed: 'Widowed' }[m.marital_status] || m.marital_status) : null;

  return (
    <div className={`member-card ${expanded ? 'expanded' : ''}`}>
      <button type='button' className='member-card-header' onClick={onToggle} aria-expanded={expanded}>
        <span className='member-card-avatar'>
          <Avatar name={m.full_name} size='sm' />
        </span>
        <span className='member-card-info'>
          <span className='member-card-name'>{m.full_name}</span>
          <span className='member-card-meta'>
            {m.phone && <span>{m.phone}</span>}
            {m.email && <span>{m.email}</span>}
          </span>
        </span>
        <span className='member-card-badges'>
          <Badge variant={m.status}>{m.status === 'active' ? 'Active' : 'Inactive'}</Badge>
          {m.consecutive_absences >= 3 && <Badge variant='high'>{m.consecutive_absences} <IconTriangleAlert size={11} /></Badge>}
        </span>
        <span className={`member-card-chevron ${expanded ? 'rotated' : ''}`}>
          <IconChevronDown size={18} />
        </span>
      </button>

      {expanded && (
        <div className='member-card-body'>
          <div className='member-card-details'>
            <DetailRow label='Groups' value={(m.groups && m.groups.length) ? m.groups.map((g) => <Badge key={g.id} variant='info'>{g.name}</Badge>) : '—'} />
            <DetailRow label='Gender' value={genderLabel || '—'} />
            <DetailRow label='Birthday' value={m.birthday ? formatShortDate(m.birthday) : '—'} />
            <DetailRow label='Age' value={m.age != null ? `${m.age}` : '—'} />
            <DetailRow label='PIN' value={m.member_code ? <code style={{ letterSpacing: 4, fontWeight: 700 }}>{m.member_code}</code> : '—'} />
            <DetailRow label='Membership' value={membershipLabel || '—'} />
            <DetailRow label='Marital status' value={maritalLabel || '—'} />
            <DetailRow label='Profession' value={m.profession || '—'} />
            <DetailRow label='Residence' value={m.residence || '—'} />
            <DetailRow label='Last attended' value={m.last_attended ? formatShortDate(m.last_attended) : 'Never'} />
            <DetailRow label='Absences' value={String(m.consecutive_absences || 0)} />
            {m.notes && <DetailRow label='Notes' value={m.notes} />}
          </div>
          <div className='member-card-actions'>
            <Link className='btn btn-secondary btn-sm' to={`/admin/members/${m.id}`}>View</Link>
            <button type='button' className='btn btn-secondary btn-sm' onClick={onEdit}>Edit</button>
            <button
              type='button'
              className={'btn btn-sm ' + (m.status === 'active' ? 'btn-ghost-danger' : 'btn-secondary')}
              onClick={onToggleStatus}
            >
              {m.status === 'active' ? 'Deactivate' : 'Activate'}
            </button>
            {canTransfer && (
              <button type='button' className='btn btn-secondary btn-sm' onClick={onTransfer}>
                Transfer
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className='detail-row'>
      <span className='detail-label'>{label}</span>
      <span className='detail-value'>{value}</span>
    </div>
  );
}

export default function MembersPage() {
  const toast = useToast();
  const { user, locals, currentLocalId } = useAuth();
  const canTransfer = !!user && user.role === 'district_admin';
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [status, setStatus] = useState('all');
  const [gender, setGender] = useState('');
  const [groupId, setGroupId] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null); // member or null for create
  const [confirmTarget, setConfirmTarget] = useState(null); // member for activate/deactivate
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [expandedId, setExpandedId] = useState(null); // which member card is expanded
  // Birthday is a controlled input so we can auto-fill the read-only Age field.
  const [birthday, setBirthday] = useState('');
  const [age, setAge] = useState(null);
  // Controlled name/phone (add + edit) so the live duplicate pre-check can watch them.
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const dupCheck = useDuplicateCheck({ fullName: formName, phone: formPhone, birthday, excludeId: editing ? editing.id : null });
  const isDuplicate = dupCheck.duplicate === true;
  // local transfer (district admin only).
  const [transferTarget, setTransferTarget] = useState(null);
  const [transferring, setTransferring] = useState(false);

  // Whole years between a birthday (YYYY-MM-DD) and today. null when unset.
  const calcAge = (bd) => {
    if (!bd) return null;
    const [y, m, d] = bd.split('-').map(Number);
    if (!y || !m || !d) return null;
    const now = new Date();
    let a = now.getFullYear() - y;
    const before = now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d);
    if (before) a -= 1;
    return a >= 0 ? a : null;
  };

  useEffect(() => {
    document.title = 'Members — Church Attendance Tracker';
  }, []);

  const groupsQ = useFetch(() => api('/groups'), []);
  const listQ = useFetch(
    () => api('/members', { params: { search: debounced, status, gender: gender || undefined, groupId, page, pageSize: 12 } }),
    [debounced, status, gender, groupId, page]
  );
  const items = (listQ.data && listQ.data.items) || [];
  const total = (listQ.data && listQ.data.total) || 0;

  // Local admins control whether their ushers may add members.
  const isLocalAdmin = !!user && user.role === 'local_admin';
  const localQ = useFetch(() => api('/locals'), []);
  const myLocal = (localQ.data && localQ.data.items && localQ.data.items[0]) || null;
  const [allowUsherAdd, setAllowUsherAdd] = useState(null);
  const [togglingAllow, setTogglingAllow] = useState(false);
  useEffect(() => {
    if (myLocal) setAllowUsherAdd(!!myLocal.allow_usher_add_member);
  }, [myLocal && myLocal.id, myLocal && myLocal.allow_usher_add_member]);

  const toggleAllowUsherAdd = async () => {
    if (!myLocal || allowUsherAdd === null) return;
    setTogglingAllow(true);
    try {
      const res = await api(`/locals/${myLocal.id}/allow-usher-add`, {
        method: 'PATCH',
        body: { enabled: !allowUsherAdd },
      });
      setAllowUsherAdd(!!(res.local && res.local.allow_usher_add_member));
      toast(res.local && res.local.allow_usher_add_member
        ? 'Ushers can now add members.'
        : 'Ushers can no longer add members.');
    } catch (err) {
      toast(err.message || 'Could not change the setting.');
    } finally {
      setTogglingAllow(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setBirthday('');
    setAge(null);
    setFormName('');
    setFormPhone('');
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (member) => {
    setEditing(member);
    setBirthday(member.birthday || '');
    setAge(member.age || null);
    setFormName(member.full_name || '');
    setFormPhone(member.phone || '');
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
      groupIds: form.getAll('groupIds').map(Number),
      birthday: birthday || null,
      age: age,
      gender: form.get('gender') || null,
      membershipType: form.get('membershipType') || null,
      maritalStatus: form.get('maritalStatus') || null,
      profession: form.get('profession') || null,
      residence: form.get('residence') || null,
      status: form.get('status') || undefined,
      notes: form.get('notes'),
      localId: !editing && canTransfer && form.get('localId') ? Number(form.get('localId')) : undefined,
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

  /** Builds the yellow duplicate warning shown inside the member form modal. */
  const DuplicateWarning = () => {
    if (!dupCheck.member) return null;
    const where = dupCheck.member.local_name ? ` in ${dupCheck.member.local_name}` : '';
    return (
      <Alert variant='warning' title='Possible duplicate member'>
        <span>
          {dupCheck.member.full_name} already exists{where} (same {dupCheck.matchedOn.join(' and ')}).{' '}
          Check the members list before saving a second record.
        </span>
      </Alert>
    );
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

  const doTransfer = async (e) => {
    e.preventDefault();
    if (!transferTarget) return;
    const form = new FormData(e.target);
    const localId = Number(form.get('localId'));
    if (!localId) return;
    setTransferring(true);
    try {
      const res = await api(`/members/${transferTarget.id}/transfer`, { method: 'POST', body: { localId } });
      toast(`Moved to ${res.transferred_to || 'the new local'}.`);
      setTransferTarget(null);
      await listQ.reload();
    } catch (err) {
      toast(err.message || 'Could not transfer this member.');
    } finally {
      setTransferring(false);
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
        <Select value={gender} onChange={(e) => { setGender(e.target.value); setPage(1); }} aria-label='Filter by gender' className='select-fit'>
          <option value=''>All genders</option>
          <option value='male'>Male</option>
          <option value='female'>Female</option>
        </Select>
        {(search || status !== 'all' || gender || groupId) ? (
          <button type='button' className='btn btn-ghost btn-sm' onClick={() => { setSearch(''); setStatus('all'); setGender(''); setGroupId(''); setPage(1); }}>
            Clear filters
          </button>
        ) : null}
      </div>

      {isLocalAdmin && (
        <section className='card pad' aria-label='Usher permissions' style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 className='card-title' style={{ marginBottom: 2 }}>Allow ushers to add members</h2>
              <p className='muted small' style={{ margin: 0 }}>
                When on, your ushers see a "+" button on their screen to sign up new members for {myLocal ? myLocal.name : 'your local'}.
              </p>
            </div>
            <label className='checkbox' style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
              <input
                type='checkbox'
                role='switch'
                checked={!!allowUsherAdd}
                disabled={togglingAllow || allowUsherAdd === null}
                onChange={toggleAllowUsherAdd}
              />
              <span>{allowUsherAdd ? 'On' : 'Off'}</span>
            </label>
          </div>
        </section>
      )}

      {listQ.loading && <LoadingBlock label='Loading members…' />}
      {listQ.error && <ErrorState error={listQ.error} onRetry={listQ.reload} />}
      {!listQ.loading && !listQ.error && items.length === 0 && (
        <EmptyState icon={<IconUsers size={44} />} title='No members found' message='Try different filters, or add your first member.' action={<Button onClick={openCreate}>+ Add member</Button>} />
      )}

      {items.length > 0 && (
        <div className='member-card-grid'>
          {items.map((m) => (
            <MemberCard
              key={m.id}
              member={m}
              expanded={expandedId === m.id}
              onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
              onEdit={() => openEdit(m)}
              onToggleStatus={() => setConfirmTarget(m)}
              canTransfer={canTransfer}
              onTransfer={() => setTransferTarget(m)}
            />
          ))}
        </div>
      )}
      {items.length > 0 && <Pagination page={page} pageSize={12} total={total} onPage={setPage} />}

      <Modal open={formOpen} title={editing ? `Edit — ${editing.full_name}` : 'Add a member'} onClose={() => setFormOpen(false)} width='520px'>
        <form onSubmit={saveMember} noValidate>
          {formError && <Alert variant='error'>{formError}</Alert>}
          <DuplicateWarning />
          <Field label='Full name' id='m-name' required>
            <Input
              id='m-name'
              name='fullName'
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              required
              maxLength={120}
              autoComplete='off'
            />
          </Field>
          <div className='field-row'>
            <Field label='Email' id='m-email' hint='Optional'>
              <Input id='m-email' name='email' type='email' defaultValue={editing ? editing.email : ''} maxLength={200} />
            </Field>
            <Field label='Phone' id='m-phone' hint='Optional'>
              <Input
                id='m-phone'
                name='phone'
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                maxLength={40}
              />
            </Field>
          </div>
          <Field label='Groups' id='m-groups' hint='A member can belong to more than one group.'>
            <div className='checkbox-row'>
              {((groupsQ.data && groupsQ.data.items) || []).map((g) => (
                <label key={g.id} className='checkbox'>
                  <input
                    type='checkbox'
                    name='groupIds'
                    value={g.id}
                    defaultChecked={editing ? (editing.group_ids || []).includes(g.id) : false}
                  />
                  <span>{g.name}</span>
                </label>
              ))}
            </div>
          </Field>
          <div className='field-row'>
            <Field label='Birthday' id='m-birthday' hint='Age is calculated automatically.'>
              <Input
                id='m-birthday'
                name='birthday'
                type='date'
                value={birthday}
                onChange={(e) => {
                  const v = e.target.value;
                  setBirthday(v);
                  setAge(calcAge(v));
                }}
              />
            </Field>
            <Field label='Age' id='m-age' hint='Auto-calculated from birthday.'>
              <Input id='m-age' name='age' type='number' min={0} readOnly placeholder={age === null ? '—' : ''} value={age === null || age === undefined ? '' : age} />
            </Field>
          </div>
          <div className='field-row'>
            <Field label='Gender' id='m-gender'>
              <Select id='m-gender' name='gender' defaultValue={editing ? editing.gender || '' : ''}>
                <option value=''>Not specified</option>
                <option value='male'>Male</option>
                <option value='female'>Female</option>
              </Select>
            </Field>
          </div>
          <div className='field-row'>
            <Field label='Membership type' id='m-membershipType'>
              <Select id='m-membershipType' name='membershipType' defaultValue={editing ? editing.membership_type || '' : ''}>
                <option value=''>Not specified</option>
                <option value='new_convert'>New convert</option>
                <option value='existing'>Existing</option>
              </Select>
            </Field>
            <Field label='Marital status' id='m-maritalStatus'>
              <Select id='m-maritalStatus' name='maritalStatus' defaultValue={editing ? editing.marital_status || '' : ''}>
                <option value=''>Not specified</option>
                <option value='single'>Single</option>
                <option value='married'>Married</option>
                <option value='divorced'>Divorced</option>
                <option value='widowed'>Widowed</option>
              </Select>
            </Field>
          </div>
          <div className='field-row'>
            <Field label='Profession' id='m-profession' hint='Optional'>
              <Input id='m-profession' name='profession' defaultValue={editing ? editing.profession || '' : ''} maxLength={200} />
            </Field>
            <Field label='Place of residence' id='m-residence' hint='Optional'>
              <Input id='m-residence' name='residence' defaultValue={editing ? editing.residence || '' : ''} maxLength={200} />
            </Field>
          </div>
          {!editing && canTransfer && (
            <Field label='Local' id='m-local' hint='Which congregation this member belongs to.'>
              <Select id='m-local' name='localId' defaultValue={currentLocalId ? String(currentLocalId) : ''}>
                <option value=''>Choose a local…</option>
                {locals.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </Field>
          )}
          <div className='field-row'>
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
            <Button type='submit' loading={saving} disabled={isDuplicate}>{editing ? 'Save changes' : 'Add member'}</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!transferTarget}
        title={transferTarget ? `Transfer — ${transferTarget.full_name}` : 'Transfer member'}
        onClose={() => setTransferTarget(null)}
        width='420px'
      >
        <form onSubmit={doTransfer} noValidate>
          {transferTarget && transferTarget.local_name && (
            <p className='muted small'>Current local: <strong>{transferTarget.local_name}</strong></p>
          )}
          <p className='muted small'>Attendance history is kept. Future marking happens at the new local.</p>
          <Field label='Move to local' id='m-transfer-local' required>
            <Select id='m-transfer-local' name='localId' required>
              <option value=''>Choose a local…</option>
              {locals
                .filter((b) => !transferTarget || b.id !== transferTarget.local_id)
                .map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
            </Select>
          </Field>
          <div className='modal-actions'>
            <Button variant='secondary' type='button' onClick={() => setTransferTarget(null)}>Cancel</Button>
            <Button type='submit' loading={transferring}>Transfer</Button>
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