import { useEffect, useState } from 'react';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader } from '../../components/ui/display.jsx';
import { Alert, EmptyState, ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Button, Field, Input } from '../../components/ui/forms.jsx';
import { Modal, ConfirmDialog } from '../../components/ui/Modal.jsx';
import { IconUsers } from '../../components/ui/icons.jsx';

const EMPTY_FORM = { name: '', description: '', location: '', contactPhone: '', contactEmail: '' };

export default function BranchesPage() {
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = 'Locals — Church Attendance Tracker';
  }, []);

  const listQ = useFetch(() => api('/branches'), []);

  const openCreate = () => {
    setEditing(null);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (branch) => {
    setEditing(branch);
    setFormError('');
    setFormOpen(true);
  };

  const openDelete = (branch) => {
    setConfirmDelete(branch);
  };

  const saveBranch = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const payload = {
      name: form.get('name'),
      description: form.get('description'),
      location: form.get('location'),
      contactPhone: form.get('contactPhone'),
      contactEmail: form.get('contactEmail'),
    };

    setSaving(true);
    setFormError('');

    try {
      if (editing) {
        await api(`/branches/${editing.id}`, { method: 'PUT', body: payload });
        toast('Local updated.');
      } else {
        await api('/branches', { method: 'POST', body: payload });
        toast('Local created.');
      }
      setFormOpen(false);
      listQ.reload();
    } catch (err) {
      setFormError(err.message || 'Could not save the local.');
    } finally {
      setSaving(false);
    }
  };

  const deleteBranch = async () => {
    if (!confirmDelete) return;
    try {
      await api(`/branches/${confirmDelete.id}`, { method: 'DELETE' });
      toast('Local deactivated.');
      listQ.reload();
    } catch (err) {
      toast(err.message || 'Could not delete the local.');
    } finally {
      setConfirmDelete(null);
    }
  };

  const items = (listQ.data && listQ.data.items) || [];

  return (
    <div className='container'>
      <PageHeader
        title='Locals'
        subtitle='Manage church locals and their administrations.'
        actions={<Button onClick={openCreate}>+ Add Local</Button>}
      />

      {listQ.loading && <LoadingBlock />}
      {listQ.error && <ErrorState error={listQ.error} onRetry={listQ.reload} />}

      {!listQ.loading && !listQ.error && items.length === 0 && (
        <EmptyState
          icon={<IconUsers size={44} />}
          title='No locals yet'
          message='Create your first local to start managing multiple locations.'
          action={<Button onClick={openCreate}>+ Add Local</Button>}
        />
      )}

      {!listQ.loading && !listQ.error && items.length > 0 && (
        <div className='card'>
          <table className='table'>
            <caption className='sr-only'>Church locals</caption>
            <thead>
              <tr>
                <th scope='col'>Name</th>
                <th scope='col'>Location</th>
                <th scope='col'>Contact</th>
                <th scope='col'>Members</th>
                <th scope='col'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id}>
                  <td>
                    <strong>{b.name}</strong>
                    {b.description && <span className='muted small block'>{b.description}</span>}
                  </td>
                  <td>{b.location || '—'}</td>
                  <td>
                    {b.contact_phone && <span className='block'>{b.contact_phone}</span>}
                    {b.contact_email && <span className='block small'>{b.contact_email}</span>}
                    {!b.contact_phone && !b.contact_email && '—'}
                  </td>
                  <td>{b.member_count}</td>
                  <td>
                    <span className='row-actions'>
                      <button type='button' className='btn btn-secondary btn-sm' onClick={() => openEdit(b)}>Edit</button>
                      <button type='button' className='btn btn-ghost-danger btn-sm' onClick={() => openDelete(b)}>Delete</button>
                    </span>
                  </td>
                </tr>
              ))}
                        </tbody>
          </table>
        </div>
      )}
      <Modal open={formOpen} title={editing ? 'Edit Local' : 'Add Local'} onClose={() => setFormOpen(false)}>
        <form onSubmit={saveBranch}>
          {formError && <Alert variant="error">{formError}</Alert>}
          <Field label="Name" id="b-name"><Input id="b-name" name="name" defaultValue={editing?.name || ''} required /></Field>
          <Field label="Location" id="b-loc"><Input id="b-loc" name="location" defaultValue={editing?.location || ''} /></Field>
          <Field label="Phone" id="b-phone"><Input id="b-phone" name="contactPhone" defaultValue={editing?.contact_phone || ''} /></Field>
          <Field label="Email" id="b-email"><Input id="b-email" name="contactEmail" type="email" defaultValue={editing?.contact_email || ''} /></Field>
          <Field label="Description" id="b-desc"><textarea id="b-desc" name="description" rows="3" defaultValue={editing?.description || ''} /></Field>
          <Field label="Status" id="b-status">
            <select id="b-status" name="status" defaultValue={editing?.status || 'active'}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
          <div className="modal-actions">
            <Button variant="secondary" type="button" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Save</Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog open={!!confirmDelete} title="Delete local?" message={`Are you sure you want to delete "${confirmDelete?.name}"?`} confirmLabel="Delete" danger onConfirm={deleteBranch} onCancel={() => setConfirmDelete(null)} />
    </div>
  );
}