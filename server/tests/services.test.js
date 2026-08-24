process.env.NODE_ENV = 'test';

const { resetTables, loginAs, seedBase } = require('./helpers');

beforeEach(async () => {
  await resetTables();
});

async function setup() {
  const base = await seedBase();
  return { base, admin: await loginAs('admin@test.app') };
}

function futureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('Service management', () => {
  test('admin creates a service', async () => {
    const { admin } = await setup();
    const res = await admin.post('/api/services').send({
      serviceDate: futureDate(7),
      serviceName: 'Midweek Service',
      startTime: '18:00',
    });
    expect(res.status).toBe(201);
    expect(res.body.service.service_name).toBe('Midweek Service');
    expect(res.body.service.upcoming).toBe(true);
    expect(res.body.service.marked).toBe(0);
  });

  test('requires a service name', async () => {
    const { admin } = await setup();
    const res = await admin.post('/api/services').send({ serviceDate: futureDate(1) });
    expect(res.status).toBe(400);
  });

  test('rejects invalid dates', async () => {
    const { admin } = await setup();
    const res = await admin
      .post('/api/services')
      .send({ serviceDate: '31-12-2026', serviceName: 'X' });
    expect(res.status).toBe(400);
  });

  test('rejects negative headcount', async () => {
    const { admin } = await setup();
    const res = await admin
      .post('/api/services')
      .send({ serviceDate: futureDate(1), serviceName: 'X', totalHeadcount: -5 });
    expect(res.status).toBe(400);
  });

  test('lists services newest first with attendance counts', async () => {
    const { admin } = await setup();
    await admin.post('/api/services').send({ serviceDate: futureDate(3), serviceName: 'Future' });
    const res = await admin.get('/api/services');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items[0].service_name).toBe('Future');
    expect(Number(res.body.items[1].marked)).toBe(0);
  });

  test('updates a service', async () => {
    const { base, admin } = await setup();
    const res = await admin.put(`/api/services/${base.service.id}`).send({
      serviceDate: base.service.service_date.slice(0, 10),
      serviceName: 'Renamed Service',
      totalHeadcount: 120,
    });
    expect(res.status).toBe(200);
    expect(res.body.service.service_name).toBe('Renamed Service');
    expect(res.body.service.total_headcount).toBe(120);
  });

  test('per-service attendance is admin-only but readable by admins', async () => {
    const { base, admin } = await setup();
    const usher = await loginAs('usher@test.app');
    const blocked = await usher.get(`/api/services/${base.service.id}/attendance`);
    expect(blocked.status).toBe(403);

    const ok = await admin.get(`/api/services/${base.service.id}/attendance`);
    expect(ok.status).toBe(200);
    expect(ok.body.totals.marked).toBe(0);
  });
});