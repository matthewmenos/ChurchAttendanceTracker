import { useEffect, useState } from 'react';
import { IconWifiOff } from '../components/ui/icons.jsx';

/**
 * Full-screen offline page, shown whenever the browser reports no connection.
 * The PWA service worker keeps recently fetched data readable (NetworkFirst
 * caching in vite.config.js), so the page offers "Continue offline" instead of
 * trapping the user, and it disappears automatically once the connection
 * returns.
 */
export default function OfflinePage() {
  const [online, setOnline] = useState(navigator.onLine);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => {
      setOnline(false);
      setDismissed(false); // reappear on every fresh disconnect
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (online || dismissed) return null;

  return (
    <div className='page-center' role='alert' aria-live='assertive'>
      <div className='card message-card'>
        <div className='empty-icon' aria-hidden='true'><IconWifiOff size={44} /></div>
        <h1>You are offline</h1>
        <p className='muted'>
          No internet connection right now. Pages you visited recently may still
          work from saved data, but new changes cannot be saved until you reconnect.
        </p>
        <div className='message-actions'>
          <button type='button' className='btn btn-primary' onClick={() => window.location.reload()}>
            Try again
          </button>
          <button type='button' className='btn btn-secondary' onClick={() => setDismissed(true)}>
            Continue offline
          </button>
        </div>
      </div>
    </div>
  );
}