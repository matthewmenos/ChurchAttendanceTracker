import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Avatar } from '../ui/display.jsx';
import { Alert } from '../ui/feedback.jsx';
import ChangePasswordModal from '../ChangePasswordModal.jsx';
import { IconChurch, IconKey } from '../ui/icons.jsx';

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
          <span className='brand-mark' aria-hidden='true'><IconChurch size={22} /></span>
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