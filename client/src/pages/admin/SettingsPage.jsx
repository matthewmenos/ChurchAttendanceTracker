import { useEffect, useState } from 'react';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Badge, PageHeader, Tabs } from '../../components/ui/display.jsx';
import { Alert, EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button, Checkbox, Field, Input, Select, Textarea } from '../../components/ui/forms.jsx';
import { ConfirmDialog, Modal } from '../../components/ui/Modal.jsx';
import { IconTag } from '../../components/ui/icons.jsx';

function SettingsForm({ initial, fields, endpoint }) {
  const toast = useToast();
  const [values, setValues] = useState(initial || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setValues(initial || {});
  }, [initial]);

  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api(endpoint, { method: 'PUT', body: values });
      toast('Settings saved.');
    } catch (err) {
      setError(err.message || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className='card pad'>
      {error && <Alert variant='error'>{error}</Alert>}
      {fields.map((f) => {
        if (f.type === 'checkbox') {
          return (
            <div key={f.key} className='field'>
              <Checkbox id={f.key} checked={values[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} label={f.label} />
              {f.hint && <p className='field-hint'>{f.hint}</p>}
            </div>
          );
        }
        if (f.type === 'number') {
          return (
            <Field key={f.key} label={f.label} id={f.key} hint={f.hint}>
              <Input id={f.key} type='number' min={f.min} max={f.max} value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
          );
        }
        return (
          <Field key={f.key} label={f.label} id={f.key} hint={f.hint}>
            <Input id={f.key} value={values[f.key] ?? ''} maxLength={f.maxLength || 120} onChange={(e) => set(f.key, e.target.value)} />
          </Field>
        );
      })}
      <div className='modal-actions'>
        <Button type='submit' loading={saving}>Save settings</Button>
      </div>
    </form>
  );
}

function ResourceTab({ labelSingular, listQ, deleteConfirmText }) {
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const items = (listQ.data && listQ.data.items) || [];
  const countKey = labelSingular === 'Group' ? 'member_count' : 'service_count';

  const save = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = { name: form.get('name'), description: form.get('description'), leaderName: form.get('leaderName') };
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await api(`${listQ.endpoint}/${editing.id}`, { method: 'PUT', body: payload });
        toast('Updated.');
      } else {
        await api(listQ.endpoint, { method: 'POST', body: payload });
        toast('Added.');
      }
      setFormOpen(false);
      await listQ.reload();
    } catch (err) {
      setError(err.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusyDelete(true);
    try {
      await api(`${listQ.endpoint}/${deleteTarget.id}`, { method: 'DELETE' });
      toast('Deleted.');
      await listQ.reload();
    } catch (err) {
      toast(err.message || 'Could not delete.');
    } finally {
      setBusyDelete(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className='card'>
      <div className='card-head-row pad-inline'>
        <h2 className='card-title'>{labelSingular}s</h2>
        <Button size='sm' onClick={() => { setEditing(null); setError(''); setFormOpen(true); }}>+ New</Button>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<IconTag size={44} />} title={`No ${labelSingular.toLowerCase()}s yet`} message='Create one to start organising.' />
      ) : (
        <ul className='stack pad-inline'>
          {items.map((item) => (
            <li key={item.id} className='follow-item card-lite'>
              <span><strong>{item.name}</strong>{item.leader_name ? ` — ${item.leader_name}` : ''}{item.description ? <span className='muted small block'>{item.description}</span> : null}</span>
              <span className='row-actions'>
                <Badge variant='neutral'>{item[countKey]} {countKey === 'member_count' ? 'members' : 'services'}</Badge>
                <button type='button' className='btn btn-ghost btn-sm' onClick={() => { setEditing(item); setError(''); setFormOpen(true); }}>Edit</button>
                <button type='button' className='btn btn-ghost-danger btn-sm' onClick={() => setDeleteTarget(item)}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Modal open={formOpen} title={`${editing ? 'Edit' : 'New'} ${labelSingular.toLowerCase()}`} onClose={() => setFormOpen(false)} width='420px'>
        <form onSubmit={save} noValidate>
          {error && <Alert variant='error'>{error}</Alert>}
          <Field label='Name' id='res-name' required>
            <Input id='res-name' name='name' defaultValue={editing ? editing.name : ''} required maxLength={80} />
          </Field>
          {labelSingular === 'Group' && (
            <Field label='Leader' id='res-leader' hint='Optional'>
              <Input id='res-leader' name='leaderName' defaultValue={editing ? editing.leader_name : ''} maxLength={120} />
            </Field>
          )}
          <Field label='Description' id='res-desc' hint='Optional'>
            <Textarea id='res-desc' name='description' rows={2} maxLength={300} defaultValue={editing ? editing.description : ''} />
          </Field>
          <div className='modal-actions'>
            <Button variant='secondary' type='button' onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type='submit' loading={saving}>Save</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete ${deleteTarget ? deleteTarget.name : ''}?`}
        message={deleteConfirmText}
        confirmLabel='Delete'
        danger
        loading={busyDelete}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState('general');
  const settingsQ = useFetch(() => api('/settings'), []);
  const groupsQ = useFetch(() => api('/groups'), []);
  groupsQ.endpoint = '/groups';
  const locationsQ = useFetch(() => api('/locations'), []);
  locationsQ.endpoint = '/locations';

  useEffect(() => {
    document.title = 'Settings — Church Attendance Tracker';
  }, []);

  if (settingsQ.loading) return <div className='container'><LoadingBlock /></div>;
  if (settingsQ.error) return <div className='container'><ErrorState error={settingsQ.error} onRetry={settingsQ.reload} /></div>;

  const s = (settingsQ.data && settingsQ.data.settings) || {};
  const generalInitial = { church_name: s.church_name || '' };
  const permsInitial = {
    usher_can_correct_attendance: s.usher_can_correct_attendance === 'true',
    usher_correction_window_minutes: Number(s.usher_correction_window_minutes || 30),
    show_member_contacts_to_ushers: s.show_member_contacts_to_ushers === 'true',
  };

  return (
    <div className='container'>
      <PageHeader title='Settings' subtitle='Church identity and attendance permissions.' />
      <Tabs
        ariaLabel='Settings sections'
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'general', label: 'General' },
          { key: 'permissions', label: 'Usher permissions' },
          { key: 'groups', label: 'Groups' },
          { key: 'locations', label: 'Locations' },
        ]}
      />

      {tab === 'general' && (
        <SettingsForm
          initial={generalInitial}
          endpoint='/settings'
          fields={[{ key: 'church_name', label: 'Church name', hint: 'Shown in the sidebar and on sign-in.', maxLength: 80 }]}
        />
      )}

      {tab === 'permissions' && (
        <SettingsForm
          initial={permsInitial}
          endpoint='/settings'
          fields={[
            { key: 'usher_can_correct_attendance', type: 'checkbox', label: 'Allow ushers to correct their own records', hint: 'When off, only admins can change a saved record.' },
            { key: 'usher_correction_window_minutes', type: 'number', min: 1, max: 1440, label: 'Correction window (minutes)', hint: 'How long after saving an usher may still edit their entry.' },
            { key: 'show_member_contacts_to_ushers', type: 'checkbox', label: 'Show member contact details to ushers', hint: 'Off by default — ushers see names and groups only.' },
          ]}
        />
      )}

      {tab === 'groups' && (
        <ResourceTab labelSingular='Group' listQ={groupsQ} deleteConfirmText='Members stay in place; their group is cleared. Attendance history is not affected.' />
      )}
      {tab === 'locations' && (
        <ResourceTab labelSingular='Location' listQ={locationsQ} deleteConfirmText='Existing services keep their history; the location is cleared.' />
      )}
    </div>
  );
}