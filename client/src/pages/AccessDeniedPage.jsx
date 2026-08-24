import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export default function AccessDeniedPage() {
  const { user, logout } = useAuth();
  return (
    <div className='page-center'>
      <div className='card message-card'>
        <div className='empty-icon' aria-hidden='true'>🔒</div>
        <h1>Access denied</h1>
        <p className='muted'>
          Your account does not have permission to view that page.
          {user && <> You are signed in as <strong>{user.name}</strong> ({user.role}).</>}
        </p>
        <div className='message-actions'>
          {user ? (
            <Link className='btn btn-primary' to={user.role === 'admin' ? '/admin' : '/usher'}>
              Go to my home page
            </Link>
          ) : (
            <Link className='btn btn-primary' to='/login'>Sign in</Link>
          )}
          <button type='button' className='btn btn-secondary' onClick={() => logout().then(() => { window.location.href = '/login'; })}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}