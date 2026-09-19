import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Badge, PageHeader } from '../../components/ui/display.jsx';
import { Alert, EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button, Field, Select } from '../../components/ui/forms.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { timeAgo } from '../../utils/format.js';
import { IconUsers } from '../../components/ui/icons.jsx';

const STATUS_LABEL = { open: 'Open', closed: 'Closed' };

export default function FollowUpsPage() {
  const { currentLocalId } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const [priority, setPriority] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [listError, setListError] = useState('');
  const [syncing, setSyncing] = useState(false);

  // District admins narrow with the local switcher; local admins are
  // hard-scoped to their own local by the API.
  const listQ = useFetch(
    () => api('/followups', { params: { status, priority, localId: currentLocalId || undefined } }),
    [status, priority, currentLocalId]
  );
  const items = (listQ.data && listQ.data.items) || [];

  useEffect(() => {
    document.title = 'Follow-ups — Church Attendance Tracker';
  }, []);

  const setStatusFor = async (item, next) => {
    setBusyId(item.id);
    setListError('');
    try {
      await api(`/followups/${item.id}`, {
        method: 'PUT',
        body: { status: next, priority: item.priority },
      });
      await listQ.reload();
    } catch (err) {
      setListError(err.message || 'Could not update the follow-up.');
    } finally {
      setBusyId(null);
    }
  };

  const scan = async () => {
    setSyncing(true);
    setListError('');
    try {
      const result = await api('/followups/sync', {
        method: 'POST',
        params: { localId: currentLocalId || undefined },
      });
      const created = ((result && result.created) || []).length;
      if (result && result.disabled) {
        toast('Automatic follow-ups are switched off. Set a threshold in Settings first.');
      } else if (created > 0) {
        toast(`Added ${created} new follow-up${created === 1 ? '' : 's'}.`);
      } else {
        toast('No new follow-ups needed — everyone is within the threshold.');
      }
      await listQ.reload();
    } catch (err) {
      setListError(err.message || 'Could not scan for follow-ups.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className='container wide'>
      <PageHeader
        title='Follow-ups'
        subtitle='Members who have been away and need a visit, call, or prayer.'
        actions={
          <Button variant='secondary' loading={syncing} onClick={scan}>
            Scan for follow-ups
          </Button>
        }
      />

      <div className='filter-row'>
        <Field label='Status' id='fu-filter-status'>
          <Select id='fu-filter-status' value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value='open'>Open</option>
            <option value='closed'>Closed</option>
            <option value='all'>All</option>
          </Select>
        </Field>
        <Field label='Priority' id='fu-filter-priority'>
          <Select id='fu-filter-priority' value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value='all'>All priorities</option>
            <option value='high'>High</option>
            <option value='medium'>Medium</option>
            <option value='low'>Low</option>
          </Select>
        </Field>
      </div>
      {listError && <Alert variant='error'>{listError}</Alert>}
      {listQ.loading && <LoadingBlock label='Loading follow-ups…' />}
      {listQ.error && <ErrorState error={listQ.error} onRetry={listQ.reload} />}
      {!listQ.loading && !listQ.error && (
        <div className='card'>
          {items.length === 0 ? (
            <EmptyState
              icon={<IconUsers size={44} />}
              title={status === 'open' ? 'No open follow-ups' : 'Nothing here'}
              message={status === 'open' ? 'Everyone is being visited — well done.' : 'Try a different filter.'}
            />
          ) : (
            <Table
              caption='Follow-up plans'
              rows={items}
              getRowKey={(r) => r.id}
              columns={[
                {
                  key: 'member_name',
                  label: 'Member',
                  render: (r) => (
                    <Link to={`/admin/members/${r.member_id}`} className='link-strong'>
                      {r.member_name}
                    </Link>
                  ),
                },
                { key: 'group_name', label: 'Group', render: (r) => r.group_name || '—' },
                {
                  key: 'priority',
                  label: 'Priority',
                  render: (r) => <Badge variant={r.priority}>{(r.priority || '').toUpperCase()}</Badge>,
                },
                { key: 'reason', label: 'Reason', render: (r) => r.reason || '—' },
                { key: 'absent_weeks', label: 'Wk absent', className: 'num', render: (r) => String(r.absent_weeks ?? '—') },
                { key: 'assigned_to', label: 'Assigned to', render: (r) => r.assigned_to || '—' },
                { key: 'created_by_name', label: 'Created by', render: (r) => r.created_by_name || '—' },
                { key: 'created_at', label: 'Created', render: (r) => timeAgo(r.created_at) },
                {
                  key: 'status',
                  label: 'Status',
                  render: (r) => <Badge variant={r.status === 'open' ? 'warning' : 'ok'}>{STATUS_LABEL[r.status] || r.status}</Badge>,
                },
                {
                  key: 'actions',
                  label: 'Actions',
                  render: (r) => (
                    <span className='row-actions'>
                      {r.status === 'open' ? (
                        <Button
                          variant='secondary'
                          size='sm'
                          loading={busyId === r.id}
                          onClick={() => setStatusFor(r, 'closed')}
                        >
                          Mark done
                        </Button>
                      ) : (
                        <Button
                          variant='ghost'
                          size='sm'
                          loading={busyId === r.id}
                          onClick={() => setStatusFor(r, 'open')}
                        >
                          Reopen
                        </Button>
                      )}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
}