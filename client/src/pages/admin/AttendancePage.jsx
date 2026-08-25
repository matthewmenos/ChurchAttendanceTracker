import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useRoster from '../../hooks/useRoster.js';
import useDebounce from '../../hooks/useDebounce.js';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { Avatar, Badge, PageHeader, StatusButtons, StatusBadge } from '../../components/ui/display.jsx';
import { Alert, EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button } from '../../components/ui/forms.jsx';
import SearchInput from '../../components/ui/SearchInput.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Field, Select, Textarea } from '../../components/ui/forms.jsx';
import { formatDate, formatShortDate, formatTime, timeAgo } from '../../utils/format.js';
import { IconSearch, IconFileText, IconCheck, IconLock } from '../../components/ui/icons.jsx';

const STATUS_FILTERS = [
  ['all', 'Everyone'],
  ['unmarked', 'Unmarked'],
  ['present', 'Present'],
  ['absent', 'Absent'],
  ['excused', 'Excused'],
];

export default function AttendancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const servicesQ = useFetch(() => api('/services', { params: { pageSize: 100 } }), []);
  const services = (servicesQ.data && servicesQ.data.items) || [];

  const [search, setSearch] = useState('');
  const debounced = useDebounce(search);
  const [groupId, setGroupId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [noteTarget, setNoteTarget] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');

  const groupsQ = useFetch(() => api('/groups'), []);

  // Default to the most recent past-or-today service.
  useEffect(() => {
    if (!searchParams.get('service') && services.length > 0) {
      setSearchParams({ service: String(services[0].id) }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services]);

  const serviceId = searchParams.get('service') || '';
  const roster = useRoster(serviceId, { search: debounced, groupId, status: statusFilter });
  const rows = (roster.data && roster.data.rows) || [];
  const service = roster.data && roster.data.service;
  const closed = !!(service && service.attendance_closed);

  useEffect(() => {
    document.title = 'Attendance — Church Attendance Tracker';
  }, []);

  const effective = (row) => edits[row.member_id] || { status: row.status || '', notes: row.notes || '' };

  const dirtyIds = useMemo(
    () =>
      rows
        .filter((row) => {
          const e = effective(row);
          const changed = e.status !== (row.status || '') || e.notes !== (row.notes || '');
          return changed && (e.status || row.attendance_id);
        })
        .map((r) => r.member_id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, edits]
  );

  const markedCount = rows.filter((r) => effective(r).status).length;

  const setStatus = (row, status) => {
    setEdits((prev) => ({ ...prev, [row.member_id]: { ...effective(row), status } }));
  };

  const openNote = (row) => {
    setNoteTarget(row);
    setNoteDraft(effective(row).notes || '');
  };

  const saveNote = () => {
    if (!noteTarget) return;
    setEdits((prev) => ({ ...prev, [noteTarget.member_id]: { ...effective(noteTarget), notes: noteDraft.trim() } }));
    setNoteTarget(null);
  };

  const clearFilters = () => {
    setSearch('');
    setGroupId('');
    setStatusFilter('all');
    setEdits({});
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
      setSaveError(null);
    } catch (err) {
      setSaveError(err.message || 'Could not save all changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='container wide'>
      <PageHeader
        title='Take attendance'
        subtitle='Pick a service, mark each member, then save. Every change is audited.'
        actions={<Link to='/admin/services' className='btn btn-secondary btn-sm'>Manage services</Link>}
      />

      <div className='filter-bar card pad'>
        <Field label='Service' id='att-service' className='filter-field'>
          <Select id='att-service' value={serviceId} onChange={(e) => setSearchParams({ service: e.target.value })}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.service_name} — {formatShortDate(s.service_date)}{s.start_time ? `, ${formatTime(s.start_time)}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <SearchInput placeholder='Search member name…' onDebounce={setSearch} ariaLabel='Search members' initialValue={search} />
        <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label='Filter by group' className='select-fit'>
          <option value=''>All groups</option>
          {((groupsQ.data && groupsQ.data.items) || []).map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </Select>
        <button type='button' className='btn btn-ghost btn-sm' onClick={clearFilters}>Clear filters</button>
      </div>

      <div className='chip-row' role='group' aria-label='Filter by marked status'>
        {STATUS_FILTERS.map(([key, label]) => (
          <button
            key={key}
            type='button'
            className={'chip' + (statusFilter === key ? ' active' : '')}
            aria-pressed={statusFilter === key}
            onClick={() => setStatusFilter(key)}
          >
            {label}
          </button>
        ))}
        {roster.data && <span className='muted small'>Showing {rows.length} of {roster.data.totalEligible} members</span>}
      </div>

      {saveError && !saving && <Alert variant='error' onClose={() => setSaveError(null)}>{saveError}</Alert>}
      {closed && (
        <Alert variant='warning' title={<><IconLock size={15} /> Attendance is closed for this service</>}>
          An admin closed marking for this service{service && service.attendance_closed_by_name ? ` (${service.attendance_closed_by_name})` : ''}. Records below are read-only — reopen it from the service page to make changes.
        </Alert>
      )}
      {!closed && !saveError && dirtyIds.length === 0 && saving === false && roster.data && roster.data.markedCount > 0 && (
        <Alert variant='success'><IconCheck size={16} /> Saved — {roster.data.markedCount} members marked for this service.</Alert>
      )}

      {roster.loading && <LoadingBlock label='Loading roster…' />}
      {roster.error && <ErrorState error={roster.error} onRetry={roster.reload} />}
      {!roster.loading && !roster.error && rows.length === 0 && (
        <EmptyState icon={<IconSearch size={44} />} title='Nobody matches these filters' message='Adjust your search or filters, or add members first.' />
      )}

      {rows.length > 0 && (
        <ul className='mark-list' aria-label='Member attendance list'>
          {rows.map((row) => {
            const e = effective(row);
            return (
              <li key={row.member_id} className={'mark-row card' + (e.status ? ` marked-${e.status}` : '')}>
                <Avatar name={row.full_name} />
                <span className='mark-name'>
                  <strong>{row.full_name}</strong>
                  <span className='muted small'>
                    {row.group_name || 'No group'}
                    {row.phone ? ` · ${row.phone}` : ''}
                  </span>
                </span>
                {row.recorded_by_name && (
                  <span className='mark-audit muted small' title='Who recorded this entry'>
                    by {row.recorded_by_name} · {timeAgo(row.updated_at)}
                  </span>
                )}
                {closed ? (
                  <StatusBadge status={e.status || ''} />
                ) : (
                  <button
                    type='button'
                    className={'icon-btn note-btn' + ((e.notes && e.notes.length) ? ' has-note' : '')}
                    onClick={() => openNote(row)}
                    aria-label={`Edit note for ${row.full_name}`}
                  >
                    {e.notes && e.notes.length ? (
                      <span className='note-glyph'>
                        <IconFileText size={18} />
                        <IconCheck size={11} />
                      </span>
                    ) : (
                      <IconFileText size={18} />
                    )}
                  </button>
                )}
                {closed ? null : (
                  <StatusButtons value={e.status || ''} onChange={(v) => setStatus(row, v)} ariaLabel={`Status for ${row.full_name}`} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <footer className='save-bar' role='region' aria-label='Save attendance'>
        <div className='save-info'>
          <Badge variant='info'>{markedCount}/{rows.length} marked</Badge>
          {dirtyIds.length > 0 ? <Badge variant='warning'>{dirtyIds.length} unsaved</Badge> : null}
          {roster.data && roster.data.lastUpdated && !dirtyIds.length && (
            <span className='muted small'>Last updated {timeAgo(roster.data.lastUpdated)}</span>
          )}
        </div>
        <div className='save-actions'>
          {!closed && dirtyIds.length > 0 && <Button variant='ghost' onClick={() => setEdits({})}>Discard</Button>}
          {closed ? (
            <span className='muted small'><IconLock size={14} style={{ verticalAlign: '-2px' }} /> Marking is closed for this service</span>
          ) : (
            <Button size='lg' loading={saving} disabled={dirtyIds.length === 0 || !serviceId} onClick={saveAll}>Save attendance</Button>
          )}
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
        <Field label='Optional note' id='admin-note'>
          <Textarea id='admin-note' value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} maxLength={500} />
        </Field>
      </Modal>
    </div>
  );
}