import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { Badge, PageHeader } from '../../components/ui/display.jsx';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { formatDate, formatTime } from '../../utils/format.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function UsherHomePage() {
  const { user } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const { data, loading, error, reload } = useFetch(
    () => api('/services', { params: { pageSize: 60 } }),
    []
  );

  useEffect(() => {
    document.title = 'Take attendance — Church Attendance Tracker';
  }, []);

  const services = (data && data.items) || [];
  const todays = services.filter((s) => String(s.service_date).slice(0, 10) === today);
  const upcoming = services.filter((s) => s.upcoming && String(s.service_date).slice(0, 10) !== today);
  const recent = services.filter((s) => !s.upcoming).slice(0, 4);

  const ServiceCard = ({ service, highlight }) => (
    <Link
      to={`/usher/mark/${service.id}`}
      className={'service-card card' + (highlight ? ' highlight' : '')}
    >
      <div className='service-card-main'>
        <strong>{service.service_name}</strong>
        <span className='muted'>
          {formatDate(service.service_date)}{service.start_time ? ` · ${formatTime(service.start_time)}` : ''}
          {service.location_name ? ` · ${service.location_name}` : ''}
        </span>
      </div>
      <span className='service-card-cta'>{highlight ? 'Start now →' : 'Open →'}</span>
    </Link>
  );

  return (
    <div className='container narrow'>
      <PageHeader
        title={`${greeting()}, ${user ? user.name.split(' ')[0] : ''}! 👋`}
        subtitle='Choose the current service, then mark each member with a single tap.'
      />

      {loading && <LoadingBlock label='Loading services…' />}
      {error && <ErrorState error={error} onRetry={reload} />}

      {!loading && !error && (
        <>
          <section aria-labelledby='today-heading'>
            <h2 id='today-heading' className='section-title'>Today</h2>
            {todays.length === 0 ? (
              <EmptyState icon='🗓️' title='No services scheduled for today' message='Check upcoming services below or ask your admin to add one.' />
            ) : (
              <div className='stack'>
                {todays.map((s) => <ServiceCard key={s.id} service={s} highlight />)}
              </div>
            )}
          </section>

          {upcoming.length > 0 && (
            <section aria-labelledby='upcoming-heading'>
              <h2 id='upcoming-heading' className='section-title'>Upcoming</h2>
              <div className='stack'>
                {upcoming.slice(0, 4).map((s) => <ServiceCard key={s.id} service={s} />)}
              </div>
            </section>
          )}

          {recent.length > 0 && (
            <section aria-labelledby='recent-heading'>
              <h2 id='recent-heading' className='section-title'>Recent services</h2>
              <div className='stack'>
                {recent.map((s) => (
                  <Link key={s.id} to={`/usher/mark/${s.id}`} className='service-card card compact'>
                    <span>{s.service_name}</span>
                    <Badge variant='neutral'>{formatDate(s.service_date)}</Badge>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}