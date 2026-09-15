import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Alert } from '../ui/feedback.jsx';
import Logo from '../ui/Logo.jsx';
import { IconCalendar, IconUsers, IconClipboardCheck, IconSettings } from '../ui/icons.jsx';

const TABS = [
  { to: '/usher', label: 'Home', icon: IconCalendar, end: true },
  { to: '/usher/visitors', label: 'Visitors', icon: IconUsers },
  { to: '/usher/marks', label: 'My marks', icon: IconClipboardCheck },
  { to: '/usher/account', label: 'Account', icon: IconSettings },
];

export default function UsherLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className='usher-shell'>
      <header className='usher-topbar'>
        <div className='usher-brand'>
          <Logo />
          <span>{(user && user.churchName) || 'Attendance'}</span>
        </div>
      </header>

      {(user && user.must_change_password) && (
        <div className='container usher-banner'>
          <Alert variant='warning' title='You are using a temporary password.'>
            <button type='button' className='link-btn' onClick={() => navigate('/usher/account')}>
              Set your own password now
            </button>
          </Alert>
        </div>
      )}

      <main id='main-content' className='usher-main'>
        <Outlet />
      </main>

      <nav className='bottom-nav' aria-label='Usher sections'>
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => 'bottom-nav-item' + (isActive ? ' active' : '')}
          >
            <t.icon size={21} aria-hidden='true' />
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}