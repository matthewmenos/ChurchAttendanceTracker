import { useEffect, useState } from 'react';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Badge, PageHeader } from '../../components/ui/display.jsx';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button, Field, Input, Select } from '../../components/ui/forms.jsx';
import { IconUsers } from '../../components/ui/icons.jsx';
import { formatShortDate, timeAgo } from '../../utils/format.js';

export default function UsherVisitorsPage() {
  const toast = useToast();
  const servicesQ = useFetch(() => api('/services', { params: { pageSize: 60 } }), []);
  const services = (servicesQ.data && servicesQ.data.items) || [];
  const [serviceId, setServiceId] = useState('');

  useEffect(() => {
    document.title = 'Visitors — Church Attendance Tracker';
  }, []);

  // Pre-select today's first service, else the next upcoming one.
  useEffect(() => {
    if (serviceId || services.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const todays = services.filter((s) => String(s.service_date).slice(0, 10) === today);
    const pick = todays[0] || services.find((s) => s.upcoming) || services[0];
    setServiceId(String(pick.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicesQ.data]);

  const visitorsQ = useFetch(
    () => (serviceId ? api('/visitors', { params: { serviceId } }) : Promise.resolve(null)),
    [serviceId]
  );

  const [form, setForm] = useState({ fullName: '', phone: '', gender: '', ageGroup: '', invitedBy: '', homeArea: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const result = await api('/visitors', {
        method: 'POST',
        body: {
          serviceId: Number(serviceId),
          fullName: form.fullName,
          phone: form.phone || undefined,
          gender: form.gender || undefined,
          ageGroup: form.ageGroup || undefined,
          invitedBy: form.invitedBy || undefined,
          homeArea: form.homeArea || undefined,
        },
      });
      if (result.returning) {
        toast(`${result.visitor.full_name} registered as a returning visitor (visit #${result.visitor.visit_count}).`);
      } else {
        toast(`${result.visitor.full_name} captured. Welcome!`);
      }
      setForm((f) => ({ ...f, fullName: '', phone: '' }));
      await visitorsQ.reload();
    } catch (err) {
      setFormError(err.message || 'Could not save the visitor.');
    } finally {
      setSaving(false);
    }
  };

  const items = (visitorsQ.data && visitorsQ.data.items) || [];

  return (
    <div className='container narrow'>
      <PageHeader title='Visitors' subtitle='Capture first-time guests and review everyone recorded for a service.' />

      <div className='card pad'>
        <Field label='Service' id='uv-service' hint='New visitors are filed under this service.'>
          <Select id='uv-service' value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value=''>{servicesQ.loading ? 'Loading services…' : 'Choose a service…'}</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.service_name} · {formatShortDate(s.service_date)}</option>
            ))}
          </Select>
        </Field>

        <h2 className='card-title' style={{ marginTop: 14 }}>Capture a visitor</h2>
        <p className='field-hint'>
          Only the name is really needed — everything else is optional.
          First-time visitors with a phone number automatically receive the church thank-you message.
        </p>
        {formError && <p className='muted small' style={{ color: 'var(--red-600)' }}>{formError}</p>}
        <form onSubmit={submit} noValidate>
          <div className='field-row'>
            <Field label='Full name' id='uv-name' required>
              <Input id='uv-name' value={form.fullName} onChange={set('fullName')} maxLength={120} placeholder='e.g. Abigail Mensah' />
            </Field>
            <Field label='Phone' id='uv-phone' hint='Recognises returning visitors.'>
              <Input id='uv-phone' value={form.phone} onChange={set('phone')} maxLength={40} placeholder='e.g. 024 000 0000' />
            </Field>
          </div>
          <div className='field-row'>
            <Field label='Gender' id='uv-gender'>
              <Select id='uv-gender' value={form.gender} onChange={set('gender')}>
                <option value=''>Not specified</option>
                <option value='male'>Male</option>
                <option value='female'>Female</option>
              </Select>
            </Field>
            <Field label='Age group' id='uv-age'>
              <Select id='uv-age' value={form.ageGroup} onChange={set('ageGroup')}>
                <option value=''>Not specified</option>
                <option value='child'>Child</option>
                <option value='teen'>Teen</option>
                <option value='adult'>Adult</option>
              </Select>
            </Field>
          </div>
          <div className='field-row'>
            <Field label='Invited by' id='uv-invited'>
              <Input id='uv-invited' value={form.invitedBy} onChange={set('invitedBy')} maxLength={120} />
            </Field>
            <Field label='Home area' id='uv-area'>
              <Input id='uv-area' value={form.homeArea} onChange={set('homeArea')} maxLength={120} />
            </Field>
          </div>
          <div className='modal-actions'>
            <Button type='submit' loading={saving} disabled={!serviceId || !form.fullName.trim()}>Save visitor</Button>
          </div>
        </form>
      </div>

      <div className='card' style={{ marginTop: 16 }}>
        <h2 className='card-title pad-inline'>Visitors for this service</h2>
        {!serviceId && (
          <EmptyState icon={<IconUsers size={44} />} title='Choose a service' message='Pick a service above to see its visitors.' />
        )}
        {serviceId && visitorsQ.loading && <LoadingBlock />}
        {serviceId && visitorsQ.error && (
          <div className='pad-inline'><ErrorState error={visitorsQ.error} onRetry={visitorsQ.reload} /></div>
        )}
        {serviceId && !visitorsQ.loading && !visitorsQ.error && items.length === 0 && (
          <EmptyState icon={<IconUsers size={44} />} title='No visitors yet for this service' message='Use the form above to capture the first one.' />
        )}
        {items.length > 0 && (
          <ul className='follow-list'>
            {items.map((v) => (
              <li key={v.id} className='follow-item'>
                <span className='follow-meta' style={{ justifyContent: 'space-between' }}>
                  <span className='follow-meta'>
                    <strong>{v.full_name}</strong>
                    {v.visit_count > 1 ? <Badge variant='info'>Returning · ×{v.visit_count}</Badge> : <Badge>First visit</Badge>}
                  </span>
                  <span className='muted small'>{timeAgo(v.created_at)}</span>
                </span>
                <span className='muted small'>
                  {[v.phone, v.gender, v.age_group, v.invited_by ? `invited by ${v.invited_by}` : '', v.home_area]
                    .filter(Boolean)
                    .join(' · ') || 'No details captured'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
