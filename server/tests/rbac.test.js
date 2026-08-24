process.env.NODE_ENV = 'test';

const request = require('supertest');
const { app, db, resetTables, loginAs, seedBase } = require('./helpers');

beforeEach(async () => {
  await resetTables();
});

const adminOnlyEndpoints = [
  ['get', '/api/members'],
  ['post', '/api/members'],
  ['get', '/api/users'],
  ['post', '/api/users'],
  ['get', '/api/reports/dashboard'],
  ['get', '/api/reports/summary'],
  ['get', '/api/settings'],
  ['put', '/api/settings'],
  ['post', '/api/services'],
  ['get', '/api/followups'],
  ['get', '/api/attendance'],
];

describe('Role-based access control', () => {
  test.each(adminOnlyEndpoints)('%s %s requires authentication', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  test.each(adminOnlyEndpoints)('ushers are blocked from %s %s', async (method, path) => {
    await seedBase();
    const usher = await loginAs('usher@test.app');
    const res = await usher[method](path);
    expect(res.status).toBe(403);
  });

  test('admins can reach their endpoints', async () => {
    await seedBase();
    const admin = await loginAs('admin@test.app');
    const pairs = [
      ['get', '/api/members'],
      ['get', '/api/users'],
      ['get', '/api/settings'],
      ['get', '/api/followups'],
      ['get', '/api/attendance'],
      ['get', '/api/reports/dashboard'],
    ];
    for (const [method, path] of pairs) {
      const res = await admin[method](path);
      expect(res.status).toBe(200);
    }
  });

  test('ushers can access shared endpoints', async () => {
    await seedBase();
    const usher = await loginAs('usher@test.app');
    expect((await usher.get('/api/services')).status).toBe(200);
    expect((await usher.get('/api/groups')).status).toBe(200);
    expect((await usher.get('/api/locations')).status).toBe(200);
    expect((await usher.get('/api/settings/public')).status).toBe(200);
  });

  test('roster hides member contacts from ushers unless permitted', async () => {
    const base = await seedBase();
    const usher = await loginAs('usher@test.app');
    const roster = await usher.get(`/api/attendance/roster/${base.service.id}`);
    expect(roster.status).toBe(200);
    expect(roster.body.rows.length).toBeGreaterThan(0);
    expect(roster.body.rows[0].phone).toBeNull();
    expect(roster.body.rows[0].email).toBeNull();

    const admin = await loginAs('admin@test.app');
    const adminRoster = await admin.get(`/api/attendance/roster/${base.service.id}`);
    const alice = adminRoster.body.rows.find((r) => r.member_id === base.members[0].id);
    expect(alice.phone).toBeTruthy();
  });

  test('ushers cannot correct records they did not create', async () => {
    const base = await seedBase();
    const admin = await loginAs('admin@test.app');
    const created = await admin
      .post('/api/attendance')
      .send({ serviceId: base.service.id, memberId: base.members[0].id, status: 'present' });
    expect(created.status).toBe(201);

    const usher = await loginAs('usher@test.app');
    const res = await usher.put(`/api/attendance/${created.body.item.id}`).send({ status: 'absent' });
    expect(res.status).toBe(403);
  });

  test('deactivated accounts lose access immediately', async () => {
    await seedBase();
    const usher = await loginAs('usher@test.app');
    await db.query("UPDATE users SET status = 'inactive' WHERE email = 'usher@test.app'");
    const res = await usher.get('/api/services');
    expect(res.status).toBe(403);
  });
});