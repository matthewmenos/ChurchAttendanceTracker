import { useEffect } from 'react';
import { api } from '../../api/client.js';

export function Alert({ variant = 'info', title, children, onClose }) {
  return (
    <div className={`alert alert-${variant}`} role={variant === 'error' ? 'alert' : 'status'}>
      <div className="alert-body">
        {title && <strong className="alert-title">{title}</strong>}
        {children}
      </div>
      {onClose && (
        <button type="button" className="alert-close" onClick={onClose} aria-label="Dismiss message">×</button>
      )}
    </div>
  );
}

export function Spinner({ size = '' }) {
  return <span className={`spinner ${size}`.trim()} role="status" aria-label="Loading" />;
}

export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div className="loading-block">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ icon = '📋', title, message, action }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  useEffect(() => {
    if (error && error.status === 401) {
      // Session fully expired; the auth context will redirect.
      window.dispatchEvent(new Event('cat:unauthorized'));
    }
  }, [error]);
  return (
    <div className="empty-state error-state" role="alert">
      <div className="empty-icon" aria-hidden="true">⚠️</div>
      <h3>Something went wrong</h3>
      <p>{(error && error.message) || 'Please try again.'}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export { api };