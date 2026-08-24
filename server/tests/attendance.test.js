process.env.NODE_ENV = 'test';

const db = require('../src/config/db');
const { resetTables, loginAs, seedBase } = require('./helpers');

beforeEach(async () => {
  await resetTables();
});

async function setup() {
  const base = await seedBase();
  return { base, admin: await loginAs('admin@test.app'), usher: await loginAs('usher@test.app') };
}

async function countRows(serviceId, memberId) {
  const { rows } = await db.query(
    'SELECT COUNT(*) AS n FROM attendance WHERE service_id = $1 AND member_id = $2',
    [serviceId, memberId]
  );
  return Number(rows[0].n);
}

describe('Attendance recording', () => {
  test('an usher can mark attendance and the recorder is captured', async () => {
    const { base, usher } = await setup();
    const res = await usher.post('/api/attendance').send({
      serviceId: base.service.id,
      memberId: base.members[0].id,
      status: 'present',
      notes: 'Sat in front row',
    });
    expect(res.status).toBe(201);
    expect(res.body.item.recorded_by_user_id).toBe(base.usher.id);
    expect(await countRows(base.service.id, base.members[0].id)).toBe(1);
  });

  test('marking twice updates instead of duplicating', async () => {
    const { base, usher } = await setup();
    const payload = { serviceId: base.service.id, memberId: base.members[0].id };
    await usher.post('/api/attendance').send({ ...payload, status: 'present' });
    await usher.post('/api/attendance').send({ ...payload, status: 'absent', notes: 'Left early' });
    expect(await countRows(payload.serviceId, payload.memberId)).toBe(1);
    const roster = await usher.get(`/api/attendance/roster/${payload.serviceId}?search=alice`);
    const row = roster.body.rows.find((r) => r.member_id === payload.memberId);
    expect(row.status).toBe('absent');
    expect(row.notes).toBe('Left early');
  });

  test('excused status and notes are stored', async () => {
    const { base, usher } = await setup();
    const res = await usher.post('/api/attendance').send({
      serviceId: base.service.id,
      memberId: base.members[1].id,
      status: 'excused',
      notes: 'Travelling',
    });
    expect(res.body.item.status).toBe('excused');
    expect(res.body.item.notes).toBe('Travelling');
  });

  test('member streaks and last_attended are recomputed', async () => {
    const { base, admin } = await setup();
    const memberId = base.members[2].id;
    await admin.post('/api/attendance').send({ serviceId: base.service.id, memberId, status: 'absent' });
    let { rows } = await db.query('SELECT consecutive_absences, last_attended FROM members WHERE id = $1', [memberId]);
    expect(rows[0].consecutive_absences).toBe(1);
    expect(rows[0].last_attended).toBeNull();

    await admin.post('/api/attendance').send({ serviceId: base.service.id, memberId, status: 'present' });
    ({ rows } = await db.query('SELECT consecutive_absences, last_attended FROM members WHERE id = $1', [memberId]));
    expect(rows[0].consecutive_absences).toBe(0);
    expect(String(rows[0].last_attended).slice(0, 10)).toBe(String(base.service.service_date).slice(0, 10));
  });

  test('ushers may correct their own recent records when permitted', async () => {
    const { base, usher } = await setup();
    const created = await usher
      .post('/api/attendance')
      .send({ serviceId: base.service.id, memberId: base.members[0].id, status: 'present' });

    const fixed = await usher
      .put(`/api/attendance/${created.body.item.id}`)
      .send({ status: 'excused', notes: 'Mixed up rows' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.item.status).toBe('excused');
    expect(await countRows(base.service.id, base.members[0].id)).toBe(1);
  });

  test('corrections are blocked when the admin disables them', async () => {
    const { base, usher } = await setup();
    const created = await usher
      .post('/api/attendance')
      .send({ serviceId: base.service.id, memberId: base.members[0].id, status: 'present' });
    await db.query("UPDATE settings SET value = 'false' WHERE key = 'usher_can_correct_attendance'");

    const res = await usher.put(`/api/attendance/${created.body.item.id}`).send({ status: 'absent' });
    expect(res.status).toBe(403);
  });

  test('corrections expire after the configured window', async () => {
    const { base, usher } = await setup();
    const created = await usher
      .post('/api/attendance')
      .send({ serviceId: base.service.id, memberId: base.members[0].id, status: 'present' });
    await db.query(
      "UPDATE attendance SET recorded_at = now() - interval '2 hours' WHERE id = $1",
      [created.body.item.id]
    );
    const res = await usher.put(`/api/attendance/${created.body.item.id}`).send({ status: 'absent' });
    expect(res.status).toBe(403);
  });

  test('admins can always correct records', async () => {
    const { base, admin, usher } = await setup();
    const created = await usher
      .post('/api/attendance')
      .send({ serviceId: base.service.id, memberId: base.members[0].id, status: 'present' });
    const res = await admin
      .put(`/api/attendance/${created.body.item.id}`)
      .send({ status: 'absent' });
    expect(res.status).toBe(200);
    expect(res.body.item.updated_by_name).toBe('Admin');
  });

  test('roster counts marked members and last updated time', async () => {
    const { base, usher } = await setup();
    await usher.post('/api/attendance').send({ serviceId: base.service.id, memberId: base.members[0].id, status: 'present' });
    const roster = await usher.get(`/api/attendance/roster/${base.service.id}`);
    expect(roster.body.markedCount).toBe(1);
    expect(roster.body.lastUpdated).toBeTruthy();
  });

  test('inactive members cannot be newly marked', async () => {
    const { base, admin } = await setup();
    await admin.patch(`/api/members/${base.members[0].id}/status`).send({ status: 'inactive' });
    const res = await admin
      .post('/api/attendance')
      .send({ serviceId: base.service.id, memberId: base.members[0].id, status: 'present' });
    expect(res.status).toBe(400);
  });

  test('admins can delete a record', async () => {
    const { base, admin } = await setup();
    const created = await admin
      .post('/api/attendance')
      .send({ serviceId: base.service.id, memberId: base.members[0].id, status: 'present' });
    const del = await admin.delete(`/api/attendance/${created.body.item.id}`);
    expect(del.status).toBe(204);
    expect(await countRows(base.service.id, base.members[0].id)).toBe(0);
  });

  test('validation errors are returned clearly', async () => {
    const { usher } = await setup();
    const bad = await usher
      .post('/api/attendance')
      .send({ serviceId: 'abc', memberId: null, status: 'late' });
    expect(bad.status).toBe(400);
    const missing = await usher.post('/api/attendance').send({ status: 'present' });
    expect(missing.status).toBe(400);
  });
});