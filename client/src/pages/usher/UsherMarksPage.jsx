import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { Badge, PageHeader, StatusBadge } from '../../components/ui/display.jsx';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { IconClipboardCheck, IconLock } from '../../components/ui/icons.jsx';
import { formatShortDate, timeAgo } from '../../utils/format.js';

export default function UsherMarksPage() {
  const q = useFetch(() => api('/attendance/mine'), []);

  useEffect(() => {
    document.title = 'My marks — Church Attendance Tracker';
  }, []);

  const items = (q.data && q.data.items) || [];
  const correction = (q.data && q.data.correction) || {};

  return (
    <div className='container narrow'>
      <PageHeader title='My marks' subtitle='Attendance records you have submitted, newest first.' />

      {correction.allowed && (
        <p className='muted small'>
          You can correct your own records for up to {correction.windowMinutes} minutes after saving,
          as long as marking for that service is still open.
        </p>
      )}

      {q.loading && <LoadingBlock />}
      {q.error && <ErrorState error={q.error} onRetry={q.reload} />}

      {!q.loading && !q.error && items.length === 0 && (
        <EmptyState
          icon={<IconClipboardCheck size={44} />}
          title='Nothing recorded yet'
          message='Records you submit while marking a service will appear here.'
        />
      )}

      {items.length > 0 && (
        <ul className='stack'>
          {items.map((r) => (
            <li key={r.id} className='follow-item card-lite'>
              <span className='follow-meta' style={{ justifyContent: 'space-between' }}>
                <span>
                  <strong>{r.member_name}</strong>
                  <span className='muted small block'>
                    {formatShortDate(r.service_date)} · {r.service_name}
                    {r.updated_at ? ` · edited ${timeAgo(r.updated_at)}` : ''}
                  </span>
                </span>
                <StatusBadge status={r.status} />
                {r.marking_locked ? (
                  <Badge variant='neutral'><IconLock size={12} /> Locked</Badge>
                ) : r.can_correct ? (
                  <Link className='btn btn-ghost btn-sm' to={`/usher/mark/${r.service_id}`}>
                    Open marking
                  </Link>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
