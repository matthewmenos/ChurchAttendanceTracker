process.env.NODE_ENV = 'test';

const request = require('supertest');
const { app, db, resetTables, loginAs, seedBase } = require('./helpers');

beforeEach(async () => {
  await resetTables();
});

async function setup() {
  const base = await seedBase();
  return { base, admin: await loginAs('admin@test.app') };
}

describe('User management (admin only)', () => {
  test('admin creates an usher account with a one-time temporary password', async () => {
    const { admin } = await setup();
    const res = await admin
      .post('/api/users')
      .send({ name: 'New Usher', email: 'new.usher@test.app', role: 'usher' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('usher');
    expect(res.body.user.must_change_password).toBe(true);
    expect(res.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);

    // The new usher can sign in immediately with the temporary password.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'new.usher@test.app', password: res.body.temporaryPassword });
    expect(login.status).toBe(200);
  });

  test('duplicate emails are rejected', async () => {
    const { admin } = await setup();
    const res = await admin
      .post('/api/users')
      .send({ name: 'Clone', email: 'usher@test.app', role: 'usher' });
    expect(res.status).toBe(409);
  });

  test('user list never exposes password hashes', async () => {
    const { admin } = await setup();
    const res = await admin.get('/api/users');
    expect(res.status).toBe(200);
    for (const user of res.body.items) {
      expect(user.password_hash).toBeUndefined();
    }
  });

  test('reset-password invalidates the old password and issues a new one', async () => {
    const { admin } = await setup();
    const target = await db.query("SELECT id FROM users WHERE email = 'usher@test.app'");
    const id = target.rows[0].id;

    const res = await admin.post(`/api/users/${id}/reset-password`);
    expect(res.status).toBe(200);
    const temp = res.body.temporaryPassword;

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'usher@test.app', password: 'Passw0rd!' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'usher@test.app', password: temp });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.must_change_password).toBe(true);
  });

  test('deactivated ushers cannot sign in; reactivation restores access', async () => {
    const { admin } = await setup();
    const target = await db.query("SELECT id FROM users WHERE email = 'usher@test.app'");
    const id = target.rows[0].id;

    const off = await admin.patch(`/api/users/${id}/status`).send({ status: 'inactive' });
    expect(off.status).toBe(200);
    const blocked = await request(app)
      .post('/api/auth/login')
      .send({ email: 'usher@test.app', password: 'Passw0rd!' });
    expect(blocked.status).toBe(403);

    await admin.patch(`/api/users/${id}/status`).send({ status: 'active' });
    const ok = await request(app)
      .post('/api/auth/login')
      .send({ email: 'usher@test.app', password: 'Passw0rd!' });
    expect(ok.status).toBe(200);
  });

  test('an admin cannot deactivate their own account', async () => {
    const { base, admin } = await setup();
    const res = await admin.patch(`/api/users/${base.admin.id}/status`).send({ status: 'inactive' });
    expect(res.status).toBe(400);
  });

  test('edits update name and contact details', async () => {
    const { base, admin } = await setup();
    const res = await admin.put(`/api/users/${base.usher.id}`).send({
      name: 'Usher One Renamed',
      email: 'usher@test.app',
      phone: '+1 555-7777',
    });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Usher One Renamed');
  });

  test('records created by each usher are visible to the admin', async () => {
    const { base, admin, usher } = await setup();
    await usher.post('/api/attendance').send({
      serviceId: base.service.id,
      memberId: base.members[0].id,
      status: 'present',
    });
    await usher.post('/api/attendance').send({
      serviceId: base.service.id,
      memberId: base.members[1].id,
      status: 'absent',
    });

    const res = await admin.get(`/api/users/${base.usher.id}/attendance-records`);
    expect(res.status).toBe(200);
    expect(res.body.totals.total).toBe(2);
    expect(res.body.totals.present).toBe(1);
    expect(res.body.items[0].recorded_at).toBeTruthy();
  });
});
describe('Usernames', () => {
  test('admin can set a username; duplicates (case-insensitive) are rejected', async () => {
    await resetTables();
    await seedBase();
    const admin = await loginAs('admin@test.app');
    const ok = await admin
      .post('/api/users')
      .send({ name: 'U Two', email: 'u2@test.app', role: 'usher', username: 'usher2' });
    expect(ok.status).toBe(201);
    expect(ok.body.user.username).toBe('usher2');
    const dup = await admin
      .post('/api/users')
      .send({ name: 'U Three', email: 'u3@test.app', role: 'usher', username: 'USHER2' });
    expect(dup.status).toBe(409);
  });
});
