import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import useRoster from '../../hooks/useRoster.js';
import useDebounce from '../../hooks/useDebounce.js';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { Avatar, Badge, StatusButtons } from '../../components/ui/display.jsx';
import { Alert, EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button } from '../../components/ui/forms.jsx';
import SearchInput from '../../components/ui/SearchInput.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Textarea } from '../../components/ui/forms.jsx';
import { formatDate, formatTime } from '../../utils/format.js';

export default function UsherMarkPage() {
  const { serviceId } = useParams();
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [groupId, setGroupId] = useState('');
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [noteTarget, setNoteTarget] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');

  const groups = useFetch(() => api('/groups'), []);
  const roster = useRoster(serviceId, { search: debounced, groupId });
  const rows = (roster.data && roster.data.rows) || [];
  const service = roster.data && roster.data.service;

  useEffect(() => {
    document.title = 'Mark attendance — Church Attendance Tracker';
  }, []);

  const effective = (row) => edits[row.member_id] || { status: row.status || '', notes: row.notes || '' };
  const dirtyIds = useMemo(() => {
    return rows
      .filter((row) => {
        const e = effective(row);
        const changed = e.status !== (row.status || '') || e.notes !== (row.notes || '');
        return changed && (e.status || row.attendance_id);
      })
      .map((r) => r.member_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, edits]);

  const markedCount = rows.filter((r) => effective(r).status).length;

  const setStatus = (row, status) => {
    setEdits((prev) => ({
      ...prev,
      [row.member_id]: { ...effective(row), status },
    }));
  };

  const openNote = (row) => {
    setNoteTarget(row);
    setNoteDraft(effective(row).notes || '');
  };

  const saveNote = () => {
    if (!noteTarget) return;
    setEdits((prev) => ({
      ...prev,
      [noteTarget.member_id]: { ...effective(noteTarget), notes: noteDraft.trim() },
    }));
    setNoteTarget(null);
  };

  const saveAll = async () => {
    if (dirtyIds.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      for (const id of dirtyIds) {
        const e = edits[id];
        await api('/attendance', {
          method: 'POST',
          body: { serviceId: Number(serviceId), memberId: Number(id), status: e.status, notes: e.notes || '' },
        });
      }
      setEdits({});
      await roster.reload();
    } catch (err) {
      setSaveError(err.message || 'Could not save attendance. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='container narrow usher-mark'>
      <div className='mark-head'>
        <div>
          <h1 className='mark-service'>{service ? service.service_name : 'Loading…'}</h1>
          {service && (
            <p className='muted'>
              {formatDate(service.service_date)}{service.start_time ? ` · ${formatTime(service.start_time)}` : ''}
              {service.location_name ? ` · ${service.location_name}` : ''}
            </p>
          )}
        </div>
        <Link to='/usher' className='btn btn-secondary btn-sm'>Switch service</Link>
      </div>

      <div className='filter-row'>
        <SearchInput placeholder='Search members…' onDebounce={setSearch} ariaLabel='Search members by name' autoFocus />
        <select
          className='input select-fit'
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          aria-label='Filter by group'
        >
          <option value=''>All groups</option>
          {((groups.data && groups.data.items) || []).map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>

      {roster.loading && <LoadingBlock label='Loading member list…' />}
      {roster.error && <ErrorState error={roster.error} onRetry={roster.reload} />}

      {!roster.loading && !roster.error && rows.length === 0 && (
        <EmptyState icon='🔍' title='No members match' message='Try a different search or group filter.' />
      )}

      {rows.length > 0 && (
        <ul className='mark-list' aria-label='Member list'>
          {rows.map((row) => {
            const e = effective(row);
            return (
              <li key={row.member_id} className={'mark-row card' + (e.status ? ` marked-${e.status}` : '')}>
                <Avatar name={row.full_name} />
                <span className='mark-name'>
                  <strong>{row.full_name}</strong>
                  {row.group_name && <span className='muted small'>{row.group_name}</span>}
                </span>
                <button
                  type='button'
                  className={'icon-btn note-btn' + ((e.notes && e.notes.length) ? ' has-note' : '')}
                  onClick={() => openNote(row)}
                  aria-label={`Add a note for ${row.full_name}${e.notes ? ' (note saved)' : ''}`}
                  title='Add note'
                >
                  {e.notes && e.notes.length ? '📝✓' : '📝'}
                </button>
                <StatusButtons
                  value={e.status || ''}
                  onChange={(v) => setStatus(row, v)}
                  ariaLabel={`Attendance status for ${row.full_name}`}
                  size='lg'
                />
              </li>
            );
          })}
        </ul>
      )}

      <footer className='save-bar' role='region' aria-label='Save attendance'>
        <div className='save-info'>
          <Badge variant='info'>{markedCount} of {rows.length} marked</Badge>
          {dirtyIds.length > 0 && <Badge variant='warning'>{dirtyIds.length} unsaved</Badge>}
          {saveError && <Alert variant='error'>{saveError}</Alert>}
        </div>
        <div className='save-actions'>
          {dirtyIds.length > 0 && (
            <Button variant='ghost' onClick={() => setEdits({})}>Discard</Button>
          )}
          <Button size='lg' loading={saving} disabled={dirtyIds.length === 0} onClick={saveAll}>
            Save attendance{dirtyIds.length > 0 ? ` (${dirtyIds.length})` : ''}
          </Button>
        </div>
      </footer>

      <Modal
        open={!!noteTarget}
        title={noteTarget ? `Note — ${noteTarget.full_name}` : 'Add note'}
        onClose={() => setNoteTarget(null)}
        width='440px'
        footer={
          <>
            <Button variant='secondary' onClick={() => setNoteTarget(null)}>Cancel</Button>
            <Button onClick={saveNote}>Save note</Button>
          </>
        }
      >
        <Field label='Optional note' id='usher-note' hint='e.g. came late, sitting in the overflow area.'>
          <Textarea id='usher-note' value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} maxLength={500} />
        </Field>
        <p className='muted small'>The note is saved together with the attendance status.</p>
      </Modal>
    </div>
  );
}