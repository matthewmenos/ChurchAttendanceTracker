process.env.NODE_ENV = 'test';

const request = require('supertest');
const { app, db, resetTables, createUser, loginAs, getCookie } = require('./helpers');

beforeEach(async () => {
  await resetTables();
});

describe('Authentication', () => {
  test('there is no public registration endpoint', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Sneaky', email: 'sneaky@test.app', password: 'Password1' });
    expect(res.status).toBe(404);
  });

  test('login issues HttpOnly cookies and never leaks the password hash', async () => {
    await createUser({ name: 'Admin', email: 'admin@test.app', role: 'admin' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.app', password: 'Passw0rd!' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user.password_hash).toBeUndefined();
    const cookies = res.headers['set-cookie'].join(' ');
    expect(cookies).toContain('cat_access_token=');
    expect(cookies).toContain('cat_refresh_token=');
    expect(cookies.toLowerCase()).toContain('httponly');
  });

  test('wrong password and unknown email return an identical message', async () => {
    await createUser({ email: 'a@test.app' });
    const wrongPw = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@test.app', password: 'nope12345' });
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.app', password: 'whatever1' });
    expect(wrongPw.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPw.body.message).toBe(unknown.body.message);
  });

  test('login body is validated', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
  });

  test('deactivated users cannot sign in', async () => {
    await createUser({ email: 'off@test.app', status: 'inactive' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'off@test.app', password: 'Passw0rd!' });
    expect(res.status).toBe(403);
  });

  test('passwords are stored as bcrypt hashes only', async () => {
    await createUser({ email: 'hashy@test.app', password: 'PlainText9' });
    const { rows } = await db.query('SELECT password_hash FROM users WHERE email = $1', ['hashy@test.app']);
    expect(rows[0].password_hash).not.toBe('PlainText9');
    expect(rows[0].password_hash.startsWith('$2')).toBe(true);
  });

  test('me returns the signed-in user', async () => {
    await createUser({ email: 'me@test.app' });
    const ag = await loginAs('me@test.app');
    const res = await ag.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('me@test.app');
  });

  test('me rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('refresh rotates refresh tokens and revokes the old one', async () => {
    await createUser({ email: 'rf@test.app' });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rf@test.app', password: 'Passw0rd!' });
    const oldRefresh = getCookie(loginRes, 'cat_refresh_token');

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`cat_refresh_token=${oldRefresh}`]);
    expect(res.status).toBe(200);
    expect(getCookie(res, 'cat_refresh_token')).toBeTruthy();

    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', [`cat_refresh_token=${oldRefresh}`]);
    expect(replay.status).toBe(401);
  });

  test('logout revokes the session', async () => {
    await createUser({ email: 'lo@test.app' });
    const ag = await loginAs('lo@test.app');
    const res = await ag.post('/api/auth/logout');
    expect(res.status).toBe(200);
    const me = await ag.get('/api/auth/me');
    expect(me.status).toBe(401);
  });

  test('change-password verifies the current password and updates it', async () => {
    await createUser({ email: 'cp@test.app', password: 'OldPass99' });
    const ag = await loginAs('cp@test.app', 'OldPass99');

    const bad = await ag
      .post('/api/auth/change-password')
      .send({ currentPassword: 'wrong-pass', newPassword: 'NewPass99' });
    expect(bad.status).toBe(400);

    const ok = await ag
      .post('/api/auth/change-password')
      .send({ currentPassword: 'OldPass99', newPassword: 'NewPass99' });
    expect(ok.status).toBe(200);

    const reLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'cp@test.app', password: 'NewPass99' });
    expect(reLogin.status).toBe(200);
  });

  test('health check responds', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.db).toBeDefined();
  });
});
describe('Username sign-in', () => {
  test('a user can sign in with their username instead of email', async () => {
    await resetTables();
    const u = await createUser({ email: 'withname@test.app' });
    await db.query('UPDATE users SET username = $1 WHERE id = $2', ['ChiefUsher', u.id]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'chiefusher', password: 'Passw0rd!' });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('ChiefUsher');
  });
});
