process.env.NODE_ENV = 'test';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');
const { createApp } = require('../src/app');

const app = createApp();

async function resetTables() {
  await db.query(
    'TRUNCATE attendance, follow_ups, refresh_tokens, services, members, member_groups, locations, users, member_group_assignments, birthday_messages RESTART IDENTITY CASCADE'
  );
}

async function createUser({ name = 'Test User', email, password = 'Passw0rd!', role = 'usher', status = 'active' } = {}) {
  const hash = await bcrypt.hash(password, 4);
  const { rows } = await db.query(
    'INSERT INTO users (name, email, password_hash, role, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [name, email, hash, role, status]
  );
  return rows[0];
}

function agent() {
  return request.agent(app);
}

async function loginAs(email, password = 'Passw0rd!') {
  const ag = agent();
  const res = await ag.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return ag;
}

async function seedBase() {
  const admin = await createUser({ name: 'Admin', email: 'admin@test.app', role: 'admin' });
  const usher = await createUser({ name: 'Usher One', email: 'usher@test.app', role: 'usher' });
  const g = await db.query("INSERT INTO member_groups (name) VALUES ('Choir') RETURNING *");
  const m = await db.query(
    `INSERT INTO members (full_name, email) VALUES
       ('Alice Johnson', 'alice@test.app'),
       ('Brian Smith', NULL),
       ('Cynthia Lee', NULL)
     RETURNING *`,
  );
  // Alice and Brian belong to the Choir (multi-group supported).
  for (const row of m.rows.slice(0, 2)) {
    await db.query(
      'INSERT INTO member_group_assignments (member_id, group_id) VALUES ($1, $2)',
      [row.id, g.rows[0].id]
    );
  }
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const s = await db.query(
    "INSERT INTO services (service_date, service_name, start_time) VALUES ($1, 'Sunday Service', '09:30') RETURNING *",
    [dateStr]
  );
  return { admin, usher, group: g.rows[0], members: m.rows, service: s.rows[0] };
}

function getCookie(res, name) {
  const arr = res.headers['set-cookie'] || [];
  for (const c of arr) {
    const pair = c.split(';')[0];
    const idx = pair.indexOf('=');
    if (pair.slice(0, idx) === name) return pair.slice(idx + 1);
  }
  return null;
}

module.exports = { app, db, resetTables, createUser, agent, loginAs, seedBase, getCookie };