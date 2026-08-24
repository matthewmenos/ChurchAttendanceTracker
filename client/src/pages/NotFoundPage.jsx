import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export default function NotFoundPage() {
  const { user } = useAuth();
  return (
    <div className='page-center'>
      <div className='card message-card'>
        <div className='empty-icon' aria-hidden='true'>🧭</div>
        <h1>Page not found</h1>
        <p className='muted'>The page you are looking for does not exist.</p>
        <div className='message-actions'>
          <Link className='btn btn-primary' to={user ? (user.role === 'admin' ? '/admin' : '/usher') : '/login'}>
            Take me home
          </Link>
        </div>
      </div>
    </div>
  );
}