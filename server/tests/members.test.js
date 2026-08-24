process.env.NODE_ENV = 'test';

const { resetTables, loginAs, seedBase } = require('./helpers');

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