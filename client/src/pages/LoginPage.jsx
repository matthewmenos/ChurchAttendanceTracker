import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api/client.js';
import { Alert } from '../components/ui/feedback.jsx';
import { Button, Field, Input } from '../components/ui/forms.jsx';

export default function LoginPage() {
  const { user, initializing, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [churchName, setChurchName] = useState('');

  useEffect(() => {
    document.title = 'Sign in — COP Agona Ahanta';
    api('/branding')
      .then((data) => {
        if (data && data.churchName) setChurchName(data.churchName);
      })
      .catch(() => {
        // branding endpoint unreachable — heading falls back below
      });
  }, []);

  if (!initializing && user) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/usher'} replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      const loggedIn = await login(email.trim(), password);
      const dest = location.state && location.state.from;
      navigate(dest || (loggedIn.role === 'admin' ? '/admin' : '/usher'), { replace: true });
    } catch (err) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='login-page'>
      <div className='login-card card'>
        <div className='login-brand'>
          <span className='brand-mark big' aria-hidden='true'>✚</span>
          <h1>{churchName || 'COP Agona Ahanta'}</h1>
          <p className='muted'>Attendance Tracker · Sign in to continue</p>
        </div>

        <form onSubmit={submit} noValidate>
          {error && <Alert variant='error'>{error}</Alert>}
          <Field label='Email address' id='login-email' required>
            <Input
              type='email'
              autoComplete='username'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder='your work email'
              required
            />
          </Field>
          <Field label='Password' id='login-password' required>
            <Input
              type='password'
              autoComplete='current-password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder='Your password'
              required
            />
          </Field>
          <Button type='submit' loading={busy} className='btn-block btn-lg'>Sign in</Button>
        </form>

        <p className='login-foot muted'>Accounts are issued by the church administrator. Contact them if you need access.</p>
      </div>
    </div>
  );
}