import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import useRoster from '../../hooks/useRoster.js';
import useDebounce from '../../hooks/useDebounce.js';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { Avatar, Badge, StatusButtons, StatusBadge } from '../../components/ui/display.jsx';
import { Alert, EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/forms.jsx';
import SearchInput from '../../components/ui/SearchInput.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { formatDate, formatTime } from '../../utils/format.js';
import { IconSearch, IconFileText, IconCheck, IconLock, IconUsers } from '../../components/ui/icons.jsx';

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

  // ---- visitor capture ----
  const [visitors, setVisitors] = useState([]);
  const [visitorsLoading, setVisitorsLoading] = useState(false);
  const [visitorForm, setVisitorForm] = useState({ fullName: '', phone: '', gender: '', ageGroup: '', invitedBy: '', homeArea: '' });
  const [savingVisitor, setSavingVisitor] = useState(false);
  const [visitorMsg, setVisitorMsg] = useState(null);

  const loadVisitors = async () => {
    if (!serviceId) return;
    setVisitorsLoading(true);
    try {
      const res = await api('/visitors', { params: { serviceId } });
      setVisitors(res.items || []);
    } catch {
      setVisitors([]);
    } finally {
      setVisitorsLoading(false);
    }
  };

  useEffect(() => { loadVisitors(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [serviceId]);

  const submitVisitor = async (e) => {
    e.preventDefault();
    setSavingVisitor(true);
    setVisitorMsg(null);
    try {
      const res = await api('/visitors', {
        method: 'POST',
        body: {
          serviceId: Number(serviceId),
          fullName: visitorForm.fullName,
          phone: visitorForm.phone || undefined,
          gender: visitorForm.gender || undefined,
          ageGroup: visitorForm.ageGroup || undefined,
          invitedBy: visitorForm.invitedBy || undefined,
          homeArea: visitorForm.homeArea || undefined,
        },
      });
      setVisitorMsg({
        tone: res.returning ? 'info' : 'success',
        text: res.returning
          ? `${visitorForm.fullName} is a returning visitor (visit #${res.visitor.visit_count}).`
          : `Welcome, ${visitorForm.fullName}!${res.thanksStatus === 'sent' ? ' Thank-you SMS sent.' : res.thanksStatus === 'dry-run' ? ' (Thank-you SMS dry-run.)' : ''}`,
      });
      setVisitorForm({ fullName: '', phone: '', gender: '', ageGroup: '', invitedBy: '', homeArea: '' });
      await loadVisitors();
    } catch (err) {
      setVisitorMsg({ tone: 'error', text: err.message || 'Could not add the visitor.' });
    } finally {
      setSavingVisitor(false);
    }
  };

  const groups = useFetch(() => api('/groups'), []);
  const roster = useRoster(serviceId, { search: debounced, groupId });
  const rows = (roster.data && roster.data.rows) || [];
  const service = roster.data && roster.data.service;
  const closed = !!(service && (service.marking_closed ?? service.attendance_closed));

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

      {closed && (
        <Alert variant='warning' title={<><IconLock size={15} /> Attendance is closed</>}>
          An admin has closed marking for this service. The list below is read-only.
        </Alert>
      )}

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
        <EmptyState icon={<IconSearch size={44} />} title='No members match' message='Try a different search or group filter.' />
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
                {closed ? (
                  <StatusBadge status={e.status || ''} />
                ) : (
                  <button
                    type='button'
                    className={'icon-btn note-btn' + ((e.notes && e.notes.length) ? ' has-note' : '')}
                    onClick={() => openNote(row)}
                    aria-label={`Add a note for ${row.full_name}${e.notes ? ' (note saved)' : ''}`}
                    title='Add note'
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
                  <StatusButtons
                    value={e.status || ''}
                    onChange={(v) => setStatus(row, v)}
                    ariaLabel={`Attendance status for ${row.full_name}`}
                    size='lg'
                  />
                )}
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
          {!closed && dirtyIds.length > 0 && (
            <Button variant='ghost' onClick={() => setEdits({})}>Discard</Button>
          )}
          {closed ? (
            <span className='muted small'><IconLock size={14} style={{ verticalAlign: '-2px' }} /> Marking is closed</span>
          ) : (
            <Button size='lg' loading={saving} disabled={dirtyIds.length === 0} onClick={saveAll}>
              Save attendance{dirtyIds.length > 0 ? ` (${dirtyIds.length})` : ''}
            </Button>
          )}
        </div>
      </footer>

      <section className='card pad usher-visitors' style={{ marginTop: 18 }} aria-label='Visitor registration'>
        <div className='card-head-row'>
          <h2 className='card-title'><IconUsers size={18} style={{ verticalAlign: '-3px' }} /> Visitors</h2>
          <span className='muted small'>{visitors.length} recorded for this service</span>
        </div>

        <form onSubmit={submitVisitor} className='visitor-form' noValidate>
          <div className='field-row'>
            <Field label='Full name' id='uv-name' required>
              <Input id='uv-name' value={visitorForm.fullName} onChange={(e) => setVisitorForm({ ...visitorForm, fullName: e.target.value })} required maxLength={120} autoComplete='off' placeholder='e.g. Ama Kwakye' />
            </Field>
            <Field label='Phone' id='uv-phone' required hint='Used to spot returning visitors'>
              <Input id='uv-phone' value={visitorForm.phone} onChange={(e) => setVisitorForm((f) => ({ ...f, phone: e.target.value }))} required maxLength={40} autoComplete='off' placeholder='+1 555-' />
            </Field>
          </div>
          <div className='field-row'>
            <Field label='Gender' id='uv-gender'>
              <Select id='uv-gender' value={visitorForm.gender} onChange={(e) => setVisitorForm({ ...visitorForm, gender: e.target.value })}>
                <option value=''>Not specified</option>
                <option value='male'>Male</option>
                <option value='female'>Female</option>
              </Select>
            </Field>
            <Field label='Age group' id='uv-age'>
              <Select id='uv-age' value={visitorForm.ageGroup} onChange={(e) => setVisitorForm({ ...visitorForm, ageGroup: e.target.value })}>
                <option value=''>Not specified</option>
                <option value='child'>Child</option>
                <option value='teen'>Teen</option>
                <option value='adult'>Adult</option>
              </Select>
            </Field>
          </div>
          <div className='field-row'>
            <Field label='Invited by' id='uv-invited'>
              <Input id='uv-invited' value={visitorForm.invitedBy} onChange={(e) => setVisitorForm({ ...visitorForm, invitedBy: e.target.value })} maxLength={120} placeholder='Who brought them?' autoComplete='off' />
            </Field>
            <Field label='Home area' id='uv-area'>
              <Input id='uv-area' value={visitorForm.homeArea} onChange={(e) => setVisitorForm({ ...visitorForm, homeArea: e.target.value })} maxLength={120} placeholder='Neighbourhood' autoComplete='off' />
            </Field>
          </div>
          {visitorMsg && <Alert variant={visitorMsg.tone}>{visitorMsg.text}</Alert>}
          <div className='modal-actions'>
            <Button type='submit' loading={savingVisitor} disabled={!visitorForm.fullName.trim() || !visitorForm.phone.trim()}>Add visitor</Button>
          </div>
        </form>

        {visitorsLoading && <LoadingBlock label='Loading visitors…' />}
        {!visitorsLoading && visitors.length > 0 && (
          <ul className='stack' style={{ marginTop: 12 }}>
            {visitors.map((v) => (
              <li key={v.id} className='follow-item card-lite'>
                <span className='follow-meta'>
                  <strong>{v.full_name}</strong>
                  {v.visit_count > 1
                    ? <Badge variant='info'>Returning · #{v.visit_count}</Badge>
                    : <Badge variant='neutral'>First time</Badge>}
                  {v.gender && <Badge variant='neutral'>{v.gender === 'male' ? 'Male' : 'Female'}</Badge>}
                </span>
                <span className='muted small'>
                  {v.phone || 'No phone'}{v.age_group ? ` · ${v.age_group[0].toUpperCase() + v.age_group.slice(1)}` : ''}
                  {v.home_area ? ` · ${v.home_area}` : ''}{v.invited_by ? ` · invited by ${v.invited_by}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

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