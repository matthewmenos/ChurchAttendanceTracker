import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useFetch from '../../hooks/useFetch.js';
import useDuplicateCheck from '../../hooks/useDuplicateCheck.js';
import { api } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader } from '../../components/ui/display.jsx';
import { Alert } from '../../components/ui/feedback.jsx';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/forms.jsx';
import { IconChevronLeft } from '../../components/ui/icons.jsx';

/** Whole years between a birthday (YYYY-MM-DD) and today. null when unset. */
function calcAge(bd) {
  if (!bd) return null;
  const [y, m, d] = bd.split('-').map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  let a = now.getFullYear() - y;
  const before = now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d);
  if (before) a -= 1;
  return a >= 0 ? a : null;
}

/** Builds the yellow duplicate warning shown above the form fields. */
function DuplicateWarning({ member, matchedOn }) {
  if (!member) return null;
  const where = member.branch_name ? ` in ${member.branch_name}` : '';
  return (
    <Alert variant='warning' title='Possible duplicate member'>
      <span>
        {member.full_name} already exists{where} (same {matchedOn.join(' and ')}).{' '}
        Check the members list before saving a second record.
      </span>
    </Alert>
  );
}

/** Usher screen for signing up a new member (branch-admin enabled).
 *  Mirrors the admin member form - all fields, minus the branch picker
 *  (the member always joins the usher's own branch). */
export default function UsherAddMemberPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [birthday, setBirthday] = useState('');
  // Controlled name/phone so the live duplicate pre-check can watch them.
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const age = useMemo(() => calcAge(birthday), [birthday]);

  const dupCheck = useDuplicateCheck({ fullName, phone, birthday });
  const isDuplicate = dupCheck.duplicate === true;

  useEffect(() => {
    document.title = 'Add member - Church Attendance Tracker';
  }, []);

  const groupsQ = useFetch(() => api('/groups'), []);

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
          email: form.get('email') || null,
          phone: form.get('phone') || null,
          groupIds: form.getAll('groupIds').map(Number),
          birthday: birthday || null,
          age,
          gender: form.get('gender') || null,
          membershipType: form.get('membershipType') || null,
          maritalStatus: form.get('maritalStatus') || null,
          profession: form.get('profession') || null,
          residence: form.get('residence') || null,
          status: form.get('status') || 'active',
          notes: form.get('notes') || null,
        },
      });
      const m = data.member || {};
      toast(m.full_name + ' added. PIN: ' + (m.member_code || '-'), 'success');
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
      <DuplicateWarning member={dupCheck.member} matchedOn={dupCheck.matchedOn} />

      <section className='card pad' aria-label='Add member form'>
        <form onSubmit={saveMember} noValidate>
          <Field label='Full name' id='ua-name' required>
            <Input
              id='ua-name'
              name='fullName'
              required
              maxLength={120}
              autoComplete='off'
              placeholder='e.g. Ama Mensah'
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </Field>
          <div className='field-row'>
            <Field label='Email' id='ua-email' hint='Optional'>
              <Input id='ua-email' name='email' type='email' maxLength={200} />
            </Field>
            <Field label='Phone' id='ua-phone' hint='Optional'>
              <Input
                id='ua-phone'
                name='phone'
                type='tel'
                maxLength={40}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
          </div>
          <Field label='Groups' id='ua-groups' hint='A member can belong to more than one group.'>
            <div className='checkbox-row'>
              {((groupsQ.data && groupsQ.data.items) || []).map((g) => (
                <label key={g.id} className='checkbox'>
                  <input type='checkbox' name='groupIds' value={g.id} />
                  <span>{g.name}</span>
                </label>
              ))}
            </div>
          </Field>
          <div className='field-row'>
            <Field label='Birthday' id='ua-birthday' hint='Age is calculated automatically.'>
              <Input id='ua-birthday' name='birthday' type='date' value={birthday} onChange={(e) => setBirthday(e.target.value)} />
            </Field>
            <Field label='Age' id='ua-age' hint='Auto-calculated from birthday.'>
              <Input id='ua-age' name='age' type='number' min={0} readOnly placeholder={age === null ? '—' : ''} value={age === null || age === undefined ? '' : age} />
            </Field>
          </div>
          <div className='field-row'>
            <Field label='Gender' id='ua-gender'>
              <Select id='ua-gender' name='gender' defaultValue=''>
                <option value=''>Not specified</option>
                <option value='male'>Male</option>
                <option value='female'>Female</option>
              </Select>
            </Field>
          </div>
          <div className='field-row'>
            <Field label='Membership type' id='ua-membershipType'>
              <Select id='ua-membershipType' name='membershipType' defaultValue=''>
                <option value=''>Not specified</option>
                <option value='new_convert'>New convert</option>
                <option value='existing'>Existing</option>
              </Select>
            </Field>
            <Field label='Marital status' id='ua-maritalStatus'>
              <Select id='ua-maritalStatus' name='maritalStatus' defaultValue=''>
                <option value=''>Not specified</option>
                <option value='single'>Single</option>
                <option value='married'>Married</option>
                <option value='divorced'>Divorced</option>
                <option value='widowed'>Widowed</option>
              </Select>
            </Field>
          </div>
          <div className='field-row'>
            <Field label='Profession' id='ua-profession' hint='Optional'>
              <Input id='ua-profession' name='profession' maxLength={200} />
            </Field>
            <Field label='Place of residence' id='ua-residence' hint='Optional'>
              <Input id='ua-residence' name='residence' maxLength={200} />
            </Field>
          </div>
          <div className='field-row'>
            <Field label='Status' id='ua-status'>
              <Select id='ua-status' name='status' defaultValue='active'>
                <option value='active'>Active</option>
                <option value='inactive'>Inactive</option>
              </Select>
            </Field>
          </div>
          <Field label='Notes' id='ua-notes' hint='Optional - e.g. how they were invited.'>
            <Textarea id='ua-notes' name='notes' rows={2} maxLength={1000} />
          </Field>
          <div className='modal-actions'>
            <Button variant='secondary' type='button' onClick={() => navigate('/usher')}>Cancel</Button>
            <Button type='submit' loading={saving} disabled={isDuplicate}>Add member</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
