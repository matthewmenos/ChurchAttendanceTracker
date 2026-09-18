import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Avatar, Badge } from '../ui/display.jsx';
import { Alert } from '../ui/feedback.jsx';
import { Button } from '../ui/forms.jsx';
import Logo from '../ui/Logo.jsx';
import ChangePasswordModal from '../ChangePasswordModal.jsx';
import InstallPrompt from '../InstallPrompt.jsx';
import BranchSelector from '../BranchSelector.jsx';
import PullToRefresh from '../PullToRefresh.jsx';
import {
  IconChart,
  IconClipboardCheck,
  IconUsers,
  IconCalendar,
  IconTrendingUp,
  IconClipboardList,
  IconShield,
  IconSettings,
  IconMapPin,
  IconMenu,
} from '../ui/icons.jsx';

const NAV_ITEMS = [
  { to: '/admin', label: 'Overview', icon: IconChart, end: true },
  { to: '/admin/attendance', label: 'Attendance', icon: IconClipboardCheck },
  { to: '/admin/members', label: 'Members', icon: IconUsers },
  { to: '/admin/services', label: 'Services', icon: IconCalendar },
  { to: '/admin/reports', label: 'Reports', icon: IconTrendingUp },
  { to: '/admin/followups', label: 'Follow-ups', icon: IconClipboardList },
  { to: '/admin/visitors', label: 'Visitors', icon: IconUsers },
  { to: '/admin/users', label: 'Users', icon: IconShield },
  { to: '/admin/settings', label: 'Settings', icon: IconSettings },
];

const DISTRICT_NAV_ITEMS = [
  { to: '/admin/branches', label: 'Branches', icon: IconMapPin },
];

export default function AdminLayout() {
  const { user, logout, branches, currentBranchId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  // Add branches nav item for district admin
  const navItems = user?.role === 'district_admin' 
    ? [...DISTRICT_NAV_ITEMS, ...NAV_ITEMS]
    : NAV_ITEMS;

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
      {navItems.map((item) => (
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
          <Logo />
          <span className='brand-text'>{(user && user.churchName) || 'Church Attendance'}</span>
        </div>
        {nav}
        <div className='sidebar-foot'>
          <div className='user-chip'>
            <Avatar name={user ? user.name : ''} />
            <span className='user-meta'>
              <strong>{user ? user.name : ''}</strong>
              <Badge variant={user && user.role === 'district_admin' ? 'info' : 'neutral'}>
                {user?.role === 'district_admin' ? 'District' : user?.role === 'branch_admin' ? 'Branch' : 'Admin'}
              </Badge>
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
          <BranchSelector />
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
          <PullToRefresh>
            <Outlet />
          </PullToRefresh>
        </main>
      </div>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
