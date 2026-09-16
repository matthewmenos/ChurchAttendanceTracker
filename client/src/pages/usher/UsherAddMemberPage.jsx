import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader } from '../../components/ui/display.jsx';
import { Alert, ErrorState } from '../../components/ui/feedback.jsx';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/forms.jsx';
import { IconChevronLeft } from '../../components/ui/icons.jsx';

/** Usher screen for quickly signing up a new member (branch-admin enabled). */
export default function UsherAddMemberPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    document.title = 'Add member — Church Attendance Tracker';
  }, []);

  const saveMember = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    setSaving(true);
    setFormError('');
    try {
      const data = await api('/members/quick-add', {
        method: 'POST',
        body: {
          fullName: form.get('fullName'),
          phone: form.get('phone') || null,
          gender: form.get('gender') || null,
          notes: form.get('notes') || null,
        },
      });
      const m = data.member || {};
      toast(`${m.full_name || 'Member'} added. PIN: ${m.member_code || '—'}`, 'success');
      navigate('/usher');
    } catch (err) {
      setFormError(err.message || 'Could not add this member.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='container'>
      <Link to='/usher' className='link-btn back-link'><IconChevronLeft size={14} /> Back to home</Link>

      <PageHeader
        title='Add member'
        subtitle='The new member joins your branch and gets a sign-in PIN automatically.'
      />

      {formError && <Alert variant='danger' title='Could not save.'>{formError}</Alert>}

      <section className='card pad' aria-label='Add member form'>
        <form onSubmit={saveMember} noValidate>
          <Field label='Full name' id='ua-name' required>
            <Input id='ua-name' name='fullName' required maxLength={120} placeholder='e.g. Ama Mensah' />
          </Field>
          <div className='field-row'>
            <Field label='Phone' id='ua-phone'>
              <Input id='ua-phone' name='phone' type='tel' maxLength={40} />
            </Field>
            <Field label='Gender' id='ua-gender'>
              <Select id='ua-gender' name='gender' defaultValue=''>
                <option value=''>Not specified</option>
                <option value='male'>Male</option>
                <option value='female'>Female</option>
              </Select>
            </Field>
          </div>
          <Field label='Notes' id='ua-notes' hint='Optional — e.g. how they were invited.'>
            <Textarea id='ua-notes' name='notes' rows={2} maxLength={500} />
          </Field>
          <div className='modal-actions'>
            <Button variant='secondary' type='button' onClick={() => navigate('/usher')}>Cancel</Button>
            <Button type='submit' loading={saving}>Add member</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
