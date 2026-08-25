import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Avatar } from '../ui/display.jsx';
import { Alert } from '../ui/feedback.jsx';
import ChangePasswordModal from '../ChangePasswordModal.jsx';
import Logo from '../ui/Logo.jsx';
import { IconKey, IconCalendar, IconUsers, IconClipboardCheck } from '../ui/icons.jsx';

export default function UsherLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className='usher-shell'>
      <header className='usher-topbar'>
        <div className='usher-brand'>
          <Logo size={22} />
          <span>{(user && user.churchName) || 'Attendance'}</span>
        </div>
        <div className='usher-user'>
          <button type='button' className='icon-btn' onClick={() => setPwOpen(true)} aria-label='Change password' title='Change password'>
            <IconKey size={18} />
          </button>
          <Avatar name={user ? user.name : ''} />
          <span className='usher-name'>{user ? user.name.split(' ')[0] : ''}</span>
          <button type='button' className='btn btn-outline-light btn-sm' onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <nav className='tabs usher-nav' aria-label='Usher sections'>
        <NavLink end to='/usher' className={({ isActive }) => 'tab' + (isActive ? ' active' : '')}>
          <IconCalendar size={16} /> Home
        </NavLink>
        <NavLink to='/usher/visitors' className={({ isActive }) => 'tab' + (isActive ? ' active' : '')}>
          <IconUsers size={16} /> Visitors
        </NavLink>
        <NavLink to='/usher/marks' className={({ isActive }) => 'tab' + (isActive ? ' active' : '')}>
          <IconClipboardCheck size={16} /> My marks
        </NavLink>
      </nav>

      {(user && user.must_change_password) && (
        <div className='container usher-banner'>
          <Alert variant='warning' title='You are using a temporary password.'>
            <button type='button' className='link-btn' onClick={() => setPwOpen(true)}>Set your own password now</button>
          </Alert>
        </div>
      )}

      <main id='main-content' className='usher-main'>
        <Outlet />
      </main>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}