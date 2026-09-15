import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { IconCompass } from '../components/ui/icons.jsx';

export default function NotFoundPage() {
  const { user } = useAuth();
  const homePath = !user
    ? '/login'
    : user.role === 'usher'
      ? '/usher'
      : '/admin';

  return (
    <div className='page-center'>
      <div className='card message-card'>
        <div className='empty-icon' aria-hidden='true'><IconCompass size={44} /></div>
        <h1>Page not found</h1>
        <p className='muted'>The page you are looking for does not exist, or you do not have access to it.</p>
        <div className='message-actions'>
          <Link className='btn btn-primary' to={homePath}>
            Take me home
          </Link>
        </div>
      </div>
    </div>
  );
}