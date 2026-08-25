import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Modal } from './ui/Modal.jsx';
import { Alert } from './ui/feedback.jsx';
import { Button, Field, PasswordInput } from './ui/forms.jsx';

export default function ChangePasswordModal({ open, onClose }) {
  const { setUser } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCurrent(''); setNext(''); setConfirm(''); setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      const data = await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      if (data.user) setUser(data.user);
      toast('Password updated successfully.');
      reset();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not update password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="Change your password" onClose={() => { reset(); onClose(); }} width="420px">
      <form onSubmit={submit} noValidate>
        {error && <Alert variant="error">{error}</Alert>}
        <Field label="Current password" id="cp-current" required>
          <PasswordInput autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" id="cp-new" required hint="At least 8 characters.">
          <PasswordInput autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        </Field>
        <Field label="Confirm new password" id="cp-confirm" required>
          <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        <div className="modal-actions">
          <Button variant="secondary" type="button" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button type="submit" loading={saving}>Update password</Button>
        </div>
      </form>
    </Modal>
  );
}