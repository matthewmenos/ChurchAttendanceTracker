process.env.NODE_ENV = 'test';

const request = require('supertest');
const { app, db, resetTables, createUser, loginAs, seedBase } = require('./helpers');

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

describe('Branch admin scoping', () => {
  async function seedBranchAdmin() {
    const base = await seedBase();
    const { rows } = await db.query("INSERT INTO branches (name) VALUES ('Second Branch') RETURNING id");
    await createUser({
      name: 'Branch Admin',
      email: 'branch.admin@test.app',
      role: 'branch_admin',
      branchId: base.branchId,
    });
    return { base, otherBranchId: rows[0].id, branchAdmin: await loginAs('branch.admin@test.app') };
  }

  test('a branch admin reaches the admin-console endpoints', async () => {
    const { branchAdmin } = await seedBranchAdmin();
    for (const path of ['/api/members', '/api/users', '/api/settings', '/api/reports/dashboard']) {
      expect((await branchAdmin.get(path)).status).toBe(200);
    }
  });

  test('a branch admin creates an usher without naming a branch (defaults to their own)', async () => {
    const { base, branchAdmin } = await seedBranchAdmin();
    const res = await branchAdmin
      .post('/api/users')
      .send({ name: 'New Usher', email: 'new.usher@test.app', role: 'usher' });
    expect(res.status).toBe(201);
    expect(res.body.user.branch_id).toBe(base.branchId);
  });

  test('a branch admin cannot create users in another branch', async () => {
    const { otherBranchId, branchAdmin } = await seedBranchAdmin();
    const res = await branchAdmin
      .post('/api/users')
      .send({ name: 'Foreign Usher', email: 'foreign@test.app', role: 'usher', branchId: otherBranchId });
    expect(res.status).toBe(403);
  });

  test('a branch admin cannot mint another branch admin', async () => {
    const { base, branchAdmin } = await seedBranchAdmin();
    const res = await branchAdmin
      .post('/api/users')
      .send({ name: 'Peer Admin', email: 'peer@test.app', role: 'branch_admin', branchId: base.branchId });
    expect(res.status).toBe(403);
  });

  test('editing an usher keeps their branch when no branch is sent', async () => {
    const { base, branchAdmin } = await seedBranchAdmin();
    const res = await branchAdmin
      .put(`/api/users/${base.usher.id}`)
      .send({ name: 'Usher One Renamed', email: 'usher@test.app' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Usher One Renamed');
    expect(res.body.user.branch_id).toBe(base.branchId);
  });

  test('only a district admin can change a user role', async () => {
    const { base, branchAdmin } = await seedBranchAdmin();
    const blocked = await branchAdmin
      .put(`/api/users/${base.usher.id}`)
      .send({ name: 'Usher One', email: 'usher@test.app', role: 'branch_admin', branchId: base.branchId });
    expect(blocked.status).toBe(403);

    const admin = await loginAs('admin@test.app');
    const promoted = await admin
      .put(`/api/users/${base.usher.id}`)
      .send({ name: 'Usher One', email: 'usher@test.app', role: 'branch_admin', branchId: base.branchId });
    expect(promoted.status).toBe(200);
    expect(promoted.body.user.role).toBe('branch_admin');
    expect(promoted.body.user.branch_id).toBe(base.branchId);
  });

  test('a branch admin cannot change church-wide settings', async () => {
    const { branchAdmin } = await seedBranchAdmin();
    const blocked = await branchAdmin.put('/api/settings').send({ church_name: 'Renamed Church' });
    expect(blocked.status).toBe(403);

    const allowed = await branchAdmin.put('/api/settings').send({ usher_can_correct_attendance: true });
    expect(allowed.status).toBe(200);
  });
});