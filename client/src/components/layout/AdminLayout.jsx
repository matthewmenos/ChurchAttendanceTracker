import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Avatar, Badge } from '../ui/display.jsx';
import { Alert } from '../ui/feedback.jsx';
import { Button } from '../ui/forms.jsx';
import Logo from '../ui/Logo.jsx';
import ChangePasswordModal from '../ChangePasswordModal.jsx';
import InstallPrompt from '../InstallPrompt.jsx';
import {
  IconChart,
  IconClipboardCheck,
  IconUsers,
  IconCalendar,
  IconTrendingUp,
  IconShield,
  IconSettings,
  IconMenu,
} from '../ui/icons.jsx';

const NAV_ITEMS = [
  { to: '/admin', label: 'Overview', icon: IconChart, end: true },
  { to: '/admin/attendance', label: 'Attendance', icon: IconClipboardCheck },
  { to: '/admin/members', label: 'Members', icon: IconUsers },
  { to: '/admin/services', label: 'Services', icon: IconCalendar },
  { to: '/admin/reports', label: 'Reports', icon: IconTrendingUp },
  { to: '/admin/visitors', label: 'Visitors', icon: IconUsers },
  { to: '/admin/users', label: 'Users', icon: IconShield },
  { to: '/admin/settings', label: 'Settings', icon: IconSettings },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const nav = (
    <nav className='sidebar-nav' aria-label='Admin navigation'>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
        >
          <span className='nav-icon' aria-hidden='true'>
            <item.icon size={20} />
          </span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className='admin-shell'>
      <a className='skip-link' href='#main-content'>Skip to content</a>
      <aside className={'sidebar' + (navOpen ? ' open' : '')}>
        <div className='sidebar-brand'>
          <Logo size={22} />
          <span className='brand-text'>{(user && user.churchName) || 'Church Attendance'}</span>
        </div>
        {nav}
        <div className='sidebar-foot'>
          <div className='user-chip'>
            <Avatar name={user ? user.name : ''} />
            <span className='user-meta'>
              <strong>{user ? user.name : ''}</strong>
              <Badge variant={user && user.role === 'admin' ? 'info' : 'neutral'}>Admin</Badge>
            </span>
          </div>
          <button type='button' className='btn btn-ghost btn-sm btn-block' onClick={() => setPwOpen(true)}>
            Change password
          </button>
          <button type='button' className='btn btn-outline-light btn-sm btn-block' onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </aside>
      {navOpen && <div className='backdrop' onClick={() => setNavOpen(false)} aria-hidden='true' />}

      <div className='admin-main-wrap'>
        <header className='topbar'>
          <button
            type='button'
            className='icon-btn nav-toggle'
            aria-label={navOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
          >
            <IconMenu size={22} />
          </button>
          <span className='topbar-title'>Church Attendance Tracker</span>
          <InstallPrompt />
          <span className='topbar-user' title={user ? user.email : ''}>{user ? user.name : ''}</span>
        </header>

        {(user && user.must_change_password) && (
          <div className='container'>
            <Alert variant='warning' title='Please change your temporary password.' >
              Your account still uses an admin-issued password.
              <button type='button' className='link-btn' onClick={() => setPwOpen(true)}>Change it now</button>
            </Alert>
          </div>
        )}

        <main id='main-content' className='admin-main'>
          <Outlet />
        </main>
      </div>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}