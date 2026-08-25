import { useEffect, useState } from 'react';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Avatar, Badge, PageHeader } from '../../components/ui/display.jsx';
import { Alert, EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button, Field, Input, Select } from '../../components/ui/forms.jsx';
import { ConfirmDialog, Modal } from '../../components/ui/Modal.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { formatDate, formatShortDate, timeAgo } from '../../utils/format.js';
import { IconFileText } from '../../components/ui/icons.jsx';

export default function UsersPage() {
  const toast = useToast();
  const { user: me } = useAuth();
  const listQ = useFetch(() => api('/users'), []);
  const items = (listQ.data && listQ.data.items) || [];

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [tempPassword, setTempPassword] = useState(null); // { name, password }
  const [resetTarget, setResetTarget] = useState(null);
  const [statusTarget, setStatusTarget] = useState(null);
  const [busyStatus, setBusyStatus] = useState(false);
  const [recordsUser, setRecordsUser] = useState(null);
  const recordsQ = useFetch(
    () => (recordsUser ? api(`/users/${recordsUser.id}/attendance-records`) : Promise.resolve(null)),
    [recordsUser]
  );

  useEffect(() => {
    document.title = 'Users — Church Attendance Tracker';
  }, []);

  const openCreate = () => {
    setEditing(null);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    setFormError('');
    setFormOpen(true);
  };

  const saveUser = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      name: form.get('name'),
      email: form.get('email'),
      username: form.get('username'),
      phone: form.get('phone'),
      role: editing ? undefined : form.get('role'),
    };
    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        await api(`/users/${editing.id}`, { method: 'PUT', body: payload });
        toast('Account updated.');
      } else {
        const res = await api('/users', { method: 'POST', body: payload });
        toast(`Usher account created for ${res.user.name}.`);
        setTempPassword({ name: res.user.name, password: res.temporaryPassword });
      }
      setFormOpen(false);
      await listQ.reload();
    } catch (err) {
      setFormError(err.message || 'Could not save this account.');
    } finally {
      setSaving(false);
    }
  };

  const doReset = async () => {
    if (!resetTarget) return;
    try {
      const res = await api(`/users/${resetTarget.id}/reset-password`, { method: 'POST' });
      setTempPassword({ name: resetTarget.name, password: res.temporaryPassword });
      toast('Password reset.');
    } catch (err) {
      toast(err.message || 'Could not reset the password.');
    } finally {
      setResetTarget(null);
      await listQ.reload();
    }
  };

  const doToggleStatus = async () => {
    if (!statusTarget) return;
    setBusyStatus(true);
    try {
      const next = statusTarget.status === 'active' ? 'inactive' : 'active';
      await api(`/users/${statusTarget.id}/status`, { method: 'PATCH', body: { status: next } });
      toast(next === 'active' ? 'Account reactivated.' : 'Account deactivated.');
      await listQ.reload();
    } catch (err) {
      toast(err.message || 'Could not change account status.');
    } finally {
      setBusyStatus(false);
      setStatusTarget(null);
    }
  };

  return (
    <div className='container wide'>
      <PageHeader
        title='User management'
        subtitle='Create usher accounts, issue credentials and manage access.'
        actions={<Button onClick={openCreate}>+ New usher</Button>}
      />

      <Alert variant='info'>
        There is no public sign-up. Share the temporary password with the usher privately — it is shown only once.
      </Alert>

      {listQ.loading && <LoadingBlock label='Loading accounts…' />}
      {listQ.error && <ErrorState error={listQ.error} onRetry={listQ.reload} />}
      {!listQ.loading && !listQ.error && (
        <div className='card'>
          <Table
            caption='System user accounts'
            rows={items}
            getRowKey={(r) => r.id}
            columns={[
              {
                key: 'name',
                label: 'User',
                render: (u) => (
                  <span className='cell-person'>
                    <Avatar name={u.name} size='sm' />
                    <span>
                      <span className='row-title'>{u.name} {me && me.id === u.id ? <Badge variant='info'>You</Badge> : null}</span>
                      <span className='muted small block'>{u.email}{u.username ? ` · @${u.username}` : ''}</span>
                    </span>
                  </span>
                ),
              },
              { key: 'role', label: 'Role', render: (u) => <Badge variant={u.role === 'admin' ? 'info' : 'neutral'}>{u.role === 'admin' ? 'Admin' : 'Usher'}</Badge> },
              { key: 'status', label: 'Status', render: (u) => <Badge variant={u.status}>{u.status === 'active' ? 'Active' : 'Inactive'}</Badge> },
              { key: 'must_change_password', label: 'Credentials', render: (u) => (u.must_change_password ? <Badge variant='warning'>Temp password</Badge> : <Badge variant='ok'>Set</Badge>) },
              { key: 'last_login_at', label: 'Last login', render: (u) => (u.last_login_at ? timeAgo(u.last_login_at) : 'Never') },
              { key: 'records_created', label: 'Records', className: 'num' },
              {
                key: 'actions',
                label: 'Actions',
                render: (u) => (
                  <span className='row-actions'>
                    <button type='button' className='btn btn-ghost btn-sm' onClick={() => openEdit(u)}>Edit</button>
                    <button type='button' className='btn btn-ghost btn-sm' onClick={() => setRecordsUser(u)}>Records</button>
                    <button type='button' className='btn btn-ghost btn-sm' onClick={() => setResetTarget(u)}>Reset password</button>
                    {me && me.id !== u.id && (
                      <button
                        type='button'
                        className={'btn btn-sm ' + (u.status === 'active' ? 'btn-ghost-danger' : 'btn-ghost')}
                        onClick={() => setStatusTarget(u)}
                      >
                        {u.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}

      <Modal open={formOpen} title={editing ? `Edit — ${editing.name}` : 'New usher account'} onClose={() => setFormOpen(false)} width='480px'>
        <form onSubmit={saveUser} noValidate>
          {formError && <Alert variant='error'>{formError}</Alert>}
          <Field label='Full name' id='u-name' required>
            <Input id='u-name' name='name' defaultValue={editing ? editing.name : ''} required maxLength={120} />
          </Field>
          <Field label='Email' id='u-email' required hint='Used for sign-in and account notices.'>
            <Input id='u-email' name='email' type='email' defaultValue={editing ? editing.email : ''} required maxLength={200} />
          </Field>
          <Field label='Username' id='u-username' hint='Optional — they can sign in with this instead of their email.'>
            <Input id='u-username' name='username' defaultValue={editing ? editing.username : ''} maxLength={40} />
          </Field>
          <Field label='Phone' id='u-phone' hint='Optional'>
            <Input id='u-phone' name='phone' defaultValue={editing ? editing.phone : ''} maxLength={40} />
          </Field>
          {!editing && (
            <Field label='Role' id='u-role' required>
              <Select id='u-role' name='role' defaultValue='usher'>
                <option value='usher'>Usher — records attendance only</option>
                <option value='admin'>Admin — full access</option>
              </Select>
            </Field>
          )}
          <div className='modal-actions'>
            <Button variant='secondary' type='button' onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type='submit' loading={saving}>{editing ? 'Save changes' : 'Create account'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!tempPassword} title='One-time temporary password' onClose={() => setTempPassword(null)} width='440px'>
        {tempPassword && (
          <>
            <Alert variant='warning' title='Copy it now — you will not see this again.'>
              Give this to <strong>{tempPassword.name}</strong> through a private channel. They must change it after signing in.
            </Alert>
            <div className='temp-password-row'>
              <code className='temp-password'>{tempPassword.password}</code>
              <Button
                variant='secondary'
                onClick={() => {
                  navigator.clipboard.writeText(tempPassword.password).then(() => toast('Copied to clipboard.'));
                }}
              >
                Copy
              </Button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={!!resetTarget}
        title={`Reset password for ${resetTarget ? resetTarget.name : ''}?`}
        message='Their current sessions are signed out and a new one-time temporary password will be generated.'
        confirmLabel='Generate new password'
        onConfirm={doReset}
        onCancel={() => setResetTarget(null)}
      />

      <ConfirmDialog
        open={!!statusTarget}
        title={statusTarget && statusTarget.status === 'active' ? 'Deactivate account?' : 'Reactivate account?'}
        message={
          statusTarget && statusTarget.status === 'active'
            ? `${statusTarget.name} will be signed out and can no longer sign in.`
            : `${statusTarget ? statusTarget.name : ''} will be able to sign in again with the same password.`
        }
        confirmLabel={statusTarget && statusTarget.status === 'active' ? 'Deactivate' : 'Reactivate'}
        danger={!!(statusTarget && statusTarget.status === 'active')}
        loading={busyStatus}
        onConfirm={doToggleStatus}
        onCancel={() => setStatusTarget(null)}
      />

      <Modal open={!!recordsUser} title={recordsUser ? `Attendance by ${recordsUser.name}` : ''} onClose={() => setRecordsUser(null)} width='640px'>
        {recordsQ.loading && <LoadingBlock />}
        {recordsQ.data && (
          <>
            <div className='badge-row'>
              <Badge variant='info'>{recordsQ.data.totals.total} records</Badge>
              <Badge variant='present'>{recordsQ.data.totals.present} present</Badge>
              <Badge variant='absent'>{recordsQ.data.totals.absent} absent</Badge>
              <Badge variant='excused'>{recordsQ.data.totals.excused} excused</Badge>
            </div>
            {recordsQ.data.items.length === 0 ? (
              <EmptyState icon={<IconFileText size={44} />} title='No records yet' message='This user has not recorded any attendance.' />
            ) : (
              <Table
                caption='Recent attendance entries created by this user'
                rows={recordsQ.data.items}
                getRowKey={(r) => r.id}
                columns={[
                  { key: 'member_name', label: 'Member' },
                  { key: 'service_name', label: 'Service', render: (r) => `${r.service_name} · ${formatShortDate(r.service_date)}` },
                  { key: 'status', label: 'Status', render: (r) => <Badge variant={r.status}>{r.status}</Badge> },
                  { key: 'recorded_at', label: 'Recorded', render: (r) => formatDate(r.recorded_at) },
                ]}
              />
            )}
          </>
        )}
      </Modal>
    </div>
  );
}