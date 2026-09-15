import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Avatar, Badge } from '../../components/ui/display.jsx';
import { Button } from '../../components/ui/forms.jsx';
import ChangePasswordModal from '../../components/ChangePasswordModal.jsx';
import InstallPrompt from '../../components/InstallPrompt.jsx';

export default function UsherAccountPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => { document.title = 'My account — Church Attendance Tracker'; }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const roleLabel = user?.role === 'district_admin' ? 'District admin' : user?.role === 'branch_admin' ? 'Branch admin' : 'Usher';

  return (
    <div className='container'>
      <div className='card pad usher-account'>
        <div className='member-hero'>
          <Avatar name={user ? user.name : ''} size='lg' />
          <div className='member-hero-main'>
            <h1 className='member-title' style={{ margin: 0 }}>{user ? user.name : ''}</h1>
            <p className='muted' style={{ margin: '4px 0 8px' }}>{user ? user.email : ''}</p>
            <div className='follow-meta' style={{ flexWrap: 'wrap' }}>
              <Badge variant='info'>{roleLabel}</Badge>
              {user && user.branch_name && <Badge variant='neutral'>{user.branch_name}</Badge>}
            </div>
          </div>
        </div>

        <div className='member-hero-actions' style={{ marginTop: 18 }}>
          <Button onClick={() => setPwOpen(true)}>Change password</Button>
          <Button variant='secondary' onClick={handleLogout}>Sign out</Button>
          <InstallPrompt />
        </div>
      </div>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
