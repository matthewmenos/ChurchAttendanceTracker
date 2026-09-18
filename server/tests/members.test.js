process.env.NODE_ENV = 'test';

const { resetTables, loginAs, seedBase, db, app } = require('./helpers');
const request = require('supertest');

beforeEach(async () => {
  await resetTables();
});

async function setup() {
  const base = await seedBase();
  return { base, admin: await loginAs('admin@test.app') };
}

describe('Member management (admin only)', () => {
  test('creates a member', async () => {
    const { base, admin } = await setup();
    const res = await admin.post('/api/members').send({
      fullName: 'Dorothy Test',
      email: 'dorothy@test.app',
      phone: '+1 555-9999',
      groupId: base.group.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.member.full_name).toBe('Dorothy Test');
    expect(res.body.member.group_name).toBe('Choir');
    expect(res.body.member.status).toBe('active');
  });

  test('rejects a missing name', async () => {
    const { admin } = await setup();
    const res = await admin.post('/api/members').send({ email: 'x@test.app' });
    expect(res.status).toBe(400);
  });

  test('rejects an invalid email', async () => {
    const { admin } = await setup();
    const res = await admin.post('/api/members').send({ fullName: 'Bad Email', email: 'nope' });
    expect(res.status).toBe(400);
  });

  test('rejects duplicate emails', async () => {
    const { admin } = await setup();
    const dup = await admin
      .post('/api/members')
      .send({ fullName: 'Alice Clone', email: 'alice@test.app' });
    expect(dup.status).toBe(409);
  });

  test('lists members with pagination metadata', async () => {
    const { admin } = await setup();
    const res = await admin.get('/api/members?page=1&pageSize=2');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items.length).toBe(2);
    expect(res.body.page).toBe(1);
  });

  test('search finds members by name fragment', async () => {
    const { admin } = await setup();
    const res = await admin.get('/api/members?search=alice');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].full_name).toContain('Alice');
  });

  test('status and group filters work together', async () => {
    const { base, admin } = await setup();
    await admin.patch(`/api/members/${base.members[0].id}/status`).send({ status: 'inactive' });
    const active = await admin.get(`/api/members?status=active&groupId=${base.group.id}`);
    expect(active.body.items.find((m) => m.id === base.members[0].id)).toBeUndefined();
    const inactive = await admin.get('/api/members?status=inactive');
    expect(inactive.body.items.map((m) => m.id)).toContain(base.members[0].id);
  });

  test('updates a member', async () => {
    const { base, admin } = await setup();
    const res = await admin.put(`/api/members/${base.members[1].id}`).send({
      fullName: 'Brian Smith',
      phone: '+1 555-2222',
    });
    expect(res.status).toBe(200);
    expect(res.body.member.phone).toBe('+1 555-2222');
  });

  test('404 for an unknown member', async () => {
    const { admin } = await setup();
    const res = await admin.get('/api/members/99999');
    expect(res.status).toBe(404);
  });

  test('attendance history includes summary and recorder names', async () => {
    const { base, admin } = await setup();
    await admin.post('/api/attendance').send({
      serviceId: base.service.id,
      memberId: base.members[0].id,
      status: 'present',
      notes: 'Came early',
    });
    const res = await admin.get(`/api/members/${base.members[0].id}/attendance`);
    expect(res.status).toBe(200);
    expect(res.body.summary.present).toBe(1);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].recorded_by_name).toBe('Admin');
    expect(res.body.items[0].service_name).toBe('Sunday Service');
  });
});

describe('Duplicate member detection (2 of 3: name / birthday / phone)', () => {
  test('blocks same name + same phone even with different phone formatting', async () => {
    const { admin } = await setup();
    await admin.post('/api/members').send({
      fullName: 'Ama Mensah',
      phone: '+233 244 123 456',
      birthday: '1990-05-01',
    });
    const dup = await admin.post('/api/members').send({
      fullName: 'ama  mensah', // same name, different case/spacing
      phone: '0244123456', // same digits, different formatting
      birthday: '1995-08-10',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/duplicate/i);
  });

  test('blocks same name + same birthday', async () => {
    const { admin } = await setup();
    await admin.post('/api/members').send({ fullName: 'Kofi Boateng', birthday: '1985-03-12' });
    const dup = await admin.post('/api/members').send({ fullName: 'Kofi Boateng', birthday: '1985-03-12' });
    expect(dup.status).toBe(409);
  });

  test('blocks same phone + same birthday with a different name', async () => {
    const { admin } = await setup();
    await admin.post('/api/members').send({ fullName: 'Adjoa Sarpong', phone: '024 555 6677', birthday: '1978-11-20' });
    const dup = await admin.post('/api/members').send({ fullName: 'Totally Different', phone: '+233245556677', birthday: '1978-11-20' });
    expect(dup.status).toBe(409);
  });

  test('allows when only the name matches (no phone/birthday)', async () => {
    const { admin } = await setup();
    await admin.post('/api/members').send({ fullName: 'Ama Mensah', phone: '+233 244 123 456', birthday: '1990-05-01' });
    const onlyName = await admin.post('/api/members').send({ fullName: 'Ama Mensah' });
    expect(onlyName.status).toBe(201);
  });

  test('allows when only the phone matches (family sharing a phone)', async () => {
    const { admin } = await setup();
    await admin.post('/api/members').send({ fullName: 'Ama Mensah', phone: '0244123456' });
    const onlyPhone = await admin.post('/api/members').send({ fullName: 'Yaa Mensah', phone: '+233 244 123 456' });
    expect(onlyPhone.status).toBe(201);
  });

  test('allows when only the birthday matches', async () => {
    const { admin } = await setup();
    await admin.post('/api/members').send({ fullName: 'Ama Mensah', birthday: '1990-05-01' });
    const onlyBirthday = await admin.post('/api/members').send({ fullName: 'Kwame Darko', birthday: '1990-05-01' });
    expect(onlyBirthday.status).toBe(201);
  });

  test('allows a completely different member', async () => {
    const { admin } = await setup();
    await admin.post('/api/members').send({ fullName: 'Ama Mensah', phone: '0244123456', birthday: '1990-05-01' });
    const ok = await admin.post('/api/members').send({ fullName: 'Kwame Darko', phone: '0209888777', birthday: '2001-02-15' });
    expect(ok.status).toBe(201);
  });
});

describe('Duplicate detection: quick-add, edit and pre-check endpoint', () => {
  test('blocks quick-add duplicates too', async () => {
    const { base, usher } = await setup();
    await db.query('UPDATE branches SET allow_usher_add_member = TRUE WHERE id = $1', [base.branchId]);
    await db.query("UPDATE members SET phone = '0244123456', birthday = '1990-05-01' WHERE id = $1", [base.members[0].id]);
    const dup = await usher.post('/api/members/quick-add').send({
      fullName: 'alice johnson',
      phone: '+233 244 123 456',
      birthday: '2000-01-01',
    });
    expect(dup.status).toBe(409);
  });

  test('blocks an edit that turns a member into a duplicate of another', async () => {
    const { base, admin } = await setup();
    await db.query("UPDATE members SET phone = '0244123456', birthday = '1990-05-01' WHERE id = $1", [base.members[0].id]);
    const dup = await admin.put(`/api/members/${base.members[1].id}`).send({
      fullName: 'Alice Johnson',
      phone: '+233 244 123 456',
      birthday: '1990-05-01',
    });
    expect(dup.status).toBe(409);
  });

  test('allows saving a member with their own unchanged identifying data', async () => {
    const { base, admin } = await setup();
    await db.query("UPDATE members SET phone = '0244123456', birthday = '1990-05-01' WHERE id = $1", [base.members[0].id]);
    const res = await admin.put(`/api/members/${base.members[0].id}`).send({
      fullName: 'Alice Johnson',
      phone: '0244123456',
      birthday: '1990-05-01',
    });
    expect(res.status).toBe(200);
    expect(res.body.member.full_name).toBe('Alice Johnson');
  });

  test('pre-check endpoint flags a duplicate for ushers without leaking contact info', async () => {
    const { base, usher } = await setup();
    await db.query("UPDATE members SET phone = '0244123456', birthday = '1990-05-01' WHERE id = $1", [base.members[0].id]);
    const hit = await usher.get('/api/members/check-duplicate?fullName=alice%20johnson&phone=0244123456');
    expect(hit.status).toBe(200);
    expect(hit.body.duplicate).toBe(true);
    expect(hit.body.matchedOn).toEqual(expect.arrayContaining(['name', 'phone']));
    expect(hit.body.member.full_name).toBe('Alice Johnson');
    expect(hit.body.member.email).toBeUndefined();
    expect(hit.body.member.phone).toBeUndefined();
    expect(hit.body.member.member_code).toBeUndefined();
  });

  test('pre-check endpoint reports no duplicate below the 2-match threshold', async () => {
    const { base, usher } = await setup();
    await db.query("UPDATE members SET phone = '0244123456' WHERE id = $1", [base.members[0].id]);
    const miss = await usher.get('/api/members/check-duplicate?fullName=Someone%20Else&phone=0244123456');
    expect(miss.status).toBe(200);
    expect(miss.body.duplicate).toBe(false);
  });

  test('pre-check endpoint requires authentication', async () => {
    await setup();
    const res = await request(app).get('/api/members/check-duplicate?fullName=x&phone=0244123456');
    expect(res.status).toBe(401);
  });
});