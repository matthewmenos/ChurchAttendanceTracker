import { useEffect, useState } from 'react';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Badge, PageHeader, Tabs } from '../../components/ui/display.jsx';
import { Alert, EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button, Checkbox, Field, Input, Select, Textarea } from '../../components/ui/forms.jsx';
import { ConfirmDialog, Modal } from '../../components/ui/Modal.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { formatShortDate, formatTime, timeAgo } from '../../utils/format.js';
import { IconTag, IconClipboardList } from '../../components/ui/icons.jsx';

function BirthdayTab() {
  const toast = useToast();
  const previewQ = useFetch(() => api('/birthdays/today'), []);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const run = async (force) => {
    setRunning(true);
    setResult(null);
    try {
      const data = await api('/birthdays/run', { method: 'POST', body: { force } });
      setResult(data);
      toast(force ? 'Birthday run (force) complete.' : 'Birthday run complete.');
      await previewQ.reload();
    } catch (err) {
      toast(err.message || 'Birthday run failed.');
    } finally {
      setRunning(false);
    }
  };

  const p = previewQ.data || { enabled: true, members: [], date: '' };
  return (
    <div className='card pad'>
      <h2 className='card-title'>Today's birthdays</h2>
      <p className='muted'>Preview for {p.date || 'today'}. Arkasel is {p.providerConfigured ? 'configured' : 'not configured (dry-run)'}.</p>
      {previewQ.loading && <LoadingBlock />}
      {previewQ.error && <ErrorState error={previewQ.error} onRetry={previewQ.reload} />}
      {!previewQ.loading && !previewQ.error && (
        <>
          {p.members.length === 0 ? (
            <EmptyState
              icon={null}
              title='No birthdays today'
              message='Add a birthday date to a member (Members → edit) to see a preview here.'
            />
          ) : (
            <ul className='birthday-list'>
              {p.members.map((m) => (
                <li key={m.id} className='birthday-item'>
                  <div>
                    <strong>{m.full_name}</strong>
                    {m.status ? <Badge variant='neutral'>{m.status}</Badge> : null}
                    <span className='muted small block'>{m.phone || 'No phone'} · {m.age ?? '?'} years</span>
                  </div>
                  <div className='muted small'>{m.message}</div>
                </li>
              ))}
            </ul>
          )}
          <div className='modal-actions' style={{ marginTop: 12 }}>
            <Button variant='secondary' loading={running} onClick={() => run(false)} disabled={p.members.length === 0}>
              Run now
            </Button>
            <Button variant='ghost' loading={running} onClick={() => run(true)} disabled={p.members.length === 0}>
              Run again (force)
            </Button>
          </div>
          {result && (
            <p className='muted small'>
              Sent {result.sent} · failed {result.failed} · {result.results.map((r) => r.status).join(', ')}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function NotificationsTab({ enabledInitial }) {
  const toast = useToast();
  // ---- master switch (saved via /settings like the other tabs) ----
  const [enabled, setEnabled] = useState(enabledInitial);
  const [savingEnabled, setSavingEnabled] = useState(false);
  const saveEnabled = async (next) => {
    setSavingEnabled(true);
    try {
      await api('/settings', { method: 'PUT', body: { notifications_enabled: next } });
      setEnabled(next);
      toast(next ? 'SMS notifications turned on.' : 'SMS notifications turned off.');
    } catch (err) {
      toast(err.message || 'Could not save the setting.');
    } finally {
      setSavingEnabled(false);
    }
  };

  // ---- composer state ----
  const [message, setMessage] = useState('');
  const [groupId, setGroupId] = useState('');
  const [gender, setGender] = useState('');
  const [audience, setAudience] = useState(null);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const groupsQ = useFetch(() => api('/groups'), []);
  const upcomingQ = useFetch(() => api('/notifications/upcoming-services'), []);
  const historyQ = useFetch(() => api('/notifications/history', { params: { limit: 50 } }), []);

  useEffect(() => {
    let live = true;
    api('/notifications/audience', { params: { groupId: groupId || undefined, gender: gender || undefined } })
      .then((d) => { if (live) setAudience(d); })
      .catch(() => { if (live) setAudience(null); });
    return () => { live = false; };
  }, [groupId, gender]);

  const applyServiceReminder = (serviceId) => {
    const s = ((upcomingQ.data && upcomingQ.data.items) || []).find((x) => String(x.id) === String(serviceId));
    if (!s) return;
    const t = s.start_time ? ` at ${formatTime(s.start_time)}` : '';
    setMessage(`Hi {{first_name}}! Reminder: ${s.service_name} holds on ${formatShortDate(s.service_date)}${t}. Come along and bring someone. — {{church_name}}`);
  };

  const send = async () => {
    setSending(true);
    try {
      const summary = await api('/notifications/send', {
        method: 'POST',
        body: { message, groupId: groupId || undefined, gender: gender || undefined },
      });
      setLastRun(summary);
      if (summary.providerConfigured && summary.enabled) {
        toast(`SMS run complete: ${summary.sent} sent${summary.failed ? `, ${summary.failed} failed` : ''}.`);
      } else {
        toast(`Dry-run: ${summary.total} recipient(s) computed. Nothing delivered.`);
      }
      await historyQ.reload();
      setConfirmOpen(false);
    } catch (err) {
      toast(err.message || 'Could not send the notification.');
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  };

  const count = audience ? audience.count : null;
  return (
    <>
      <div className='card pad'>
        <h2 className='card-title'>SMS notifications</h2>
        <Checkbox
          id='notifications_enabled'
          checked={enabled}
          onChange={(e) => saveEnabled(e.target.checked)}
          label='Enable SMS activity notifications'
        />
        <p className='field-hint'>
          Master switch for member SMS announcements and reminders. Birthday messages have their own toggle on the Birthdays tab.
          {audience && (audience.providerConfigured
            ? ' Arkasel is configured — messages will be delivered.'
            : ' Arkasel is NOT configured — sends run in dry-run mode only.')}
          {savingEnabled ? ' Saving…' : ''}
        </p>
      </div>

      <div className='card pad' style={{ marginTop: 16 }}>
        <h2 className='card-title'>New announcement</h2>
        <Field label='Start from an upcoming service (optional)' id='nt-service' hint='Fills a ready-made reminder you can edit.'>
          <Select id='nt-service' value='' onChange={(e) => applyServiceReminder(e.target.value)}>
            <option value=''>Choose a service…</option>
            {((upcomingQ.data && upcomingQ.data.items) || []).map((s) => (
              <option key={s.id} value={s.id}>{s.service_name} · {formatShortDate(s.service_date)}</option>
            ))}
          </Select>
        </Field>

        <Field label='Message' id='nt-message' hint={`Use {{first_name}}, {{full_name}}, {{church_name}}. ${count === null ? 'Counting recipients…' : `Will be sent to ${count} member(s) with a phone number.`}`}>
          <Textarea id='nt-message' rows={4} maxLength={480} value={message} onChange={(e) => setMessage(e.target.value)} placeholder='Write your announcement…' />
        </Field>

        <div className='field-row'>
          <Field label='Send to group' id='nt-group'>
            <Select id='nt-group' value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value=''>All groups</option>
              {((groupsQ.data && groupsQ.data.items) || []).map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </Select>
          </Field>
          <Field label='Gender' id='nt-gender'>
            <Select id='nt-gender' value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value=''>Everyone</option>
              <option value='male'>Male only</option>
              <option value='female'>Female only</option>
            </Select>
          </Field>
        </div>

        <div className='modal-actions'>
          <Button variant='secondary' onClick={() => setMessage('')}>Clear</Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={!message.trim() || !count}>Send to {count ?? '…'} members</Button>
        </div>
        {lastRun && (
          <p className='muted small'>
            Last run: total {lastRun.total} · sent {lastRun.sent} · failed {lastRun.failed}
            {!lastRun.enabled || !lastRun.providerConfigured ? ' · dry-run (nothing delivered)' : ''}
          </p>
        )}
      </div>

      <div className='card' style={{ marginTop: 16 }} aria-label='SMS history'>
        <h2 className='card-title pad-inline'>Recent SMS history</h2>
        {historyQ.loading && <LoadingBlock />}
        {historyQ.error && <div className='pad-inline'><ErrorState error={historyQ.error} onRetry={historyQ.reload} /></div>}
        {!historyQ.loading && !historyQ.error && ((historyQ.data && historyQ.data.items) || []).length === 0 && (
          <EmptyState icon={<IconClipboardList size={44} />} title='No SMS sent yet' message='Announcements and reminders you send will appear here with their delivery status.' />
        )}
        {((historyQ.data && historyQ.data.items) || []).length > 0 && (
          <Table
            caption='Recently sent SMS notifications'
            rows={(historyQ.data && historyQ.data.items) || []}
            getRowKey={(r) => r.id}
            columns={[
              { key: 'created_at', label: 'When', render: (r) => timeAgo(r.created_at) },
              { key: 'member_name', label: 'Member' },
              { key: 'phone', label: 'Phone' },
              { key: 'category', label: 'Type', render: (r) => <Badge variant='neutral'>{r.category}</Badge> },
              { key: 'message', label: 'Message', render: (r) => <span title={r.message}>{r.message.length > 60 ? `${r.message.slice(0, 60)}…` : r.message}</span> },
              { key: 'status', label: 'Status', render: (r) => <Badge variant={r.status === 'sent' ? 'info' : 'high'}>{r.status}</Badge> },
            ]}
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title='Send this SMS?'
        message={`This will message ${count ?? 0} member(s) via Arkasel${audience && !audience.providerConfigured ? ' — currently in DRY-RUN mode, nothing will actually be delivered' : ''}.`}
        confirmLabel='Send now'
        loading={sending}
        onConfirm={send}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

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
  const birthdayInitial = {
    birthday_messages_enabled: s.birthday_messages_enabled !== 'false',
    birthday_message_template: s.birthday_message_template || '',
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
          { key: 'birthdays', label: 'Birthdays' },
          { key: 'notifications', label: 'SMS notifications' },
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

      {tab === 'birthdays' && (
        <>
          <SettingsForm
            initial={birthdayInitial}
            endpoint='/settings'
            fields={[
              { key: 'birthday_messages_enabled', type: 'checkbox', label: 'Send birthday messages', hint: 'Members with a birthday today receive an SMS via Arkasel.' },
              { key: 'birthday_message_template', label: 'Message template', hint: 'Use {{first_name}}, {{full_name}}, {{age}}, {{church_name}}. Must include {{first_name}}.', maxLength: 500 },
            ]}
          />
          <BirthdayTab />
        </>
      )}

      {tab === 'notifications' && (
        <NotificationsTab enabledInitial={s.notifications_enabled !== 'false'} />
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