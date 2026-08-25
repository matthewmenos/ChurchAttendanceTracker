/**
 * Seeds the database with realistic demo data.
 * Safe to re-run: clears all data tables first.
 */
const db = require('../src/config/db');
const env = require('../src/config/env');
const { hashPassword } = require('../src/utils/passwords');
const { recomputeMemberStats } = require('../src/services/stats');

// Deterministic pseudo-random generator so every seed run looks the same.
let rngState = 42;
function rnd() {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function main() {
  // Refuse to run without credentials from the environment (never hardcode).
  const missingSeed = [
    ['SEED_ADMIN_EMAIL', env.seed.adminEmail],
    ['SEED_ADMIN_PASSWORD', env.seed.adminPassword],
    ['SEED_USHER_EMAIL', env.seed.usherEmail],
    ['SEED_USHER_PASSWORD', env.seed.usherPassword],
  ].filter(([, v]) => !v);
  if (missingSeed.length) {
    console.error('Seed aborted - set these in server/.env first:');
    for (const [key] of missingSeed) console.error('  ' + key + '=...');
    process.exit(1);
  }
  console.log('Seeding database...');
  // Wipe previous demo data so the seed can be re-run safely.
  // (settings are kept — admins may have customised them)
  await db.query(
    'TRUNCATE attendance, follow_ups, refresh_tokens, services, members, member_groups, locations, users, member_group_assignments, birthday_messages RESTART IDENTITY CASCADE'
  );

  // ---------- users ----------
  const adminHash = await hashPassword(env.seed.adminPassword);
  const usherHash = await hashPassword(env.seed.usherPassword);
  const { rows: adminRows } = await db.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin') RETURNING id`,
    [env.seed.adminName, env.seed.adminEmail.toLowerCase(), adminHash]
  );
  const adminId = adminRows[0].id;

  const { rows: u1Rows } = await db.query(
    `INSERT INTO users (name, email, password_hash, role, created_by)
     VALUES ($1, $2, $3, 'usher', $4) RETURNING id`,
    [env.seed.usherName, env.seed.usherEmail.toLowerCase(), usherHash, adminId]
  );
  const usher1 = u1Rows[0].id;

  const { rows: u2Rows } = await db.query(
    `INSERT INTO users (name, email, password_hash, role, created_by)
     VALUES ($1, $2, $3, 'usher', $4) RETURNING id`,
    ['Daniel Okafor', process.env.SEED_USHER2_EMAIL || `daniel@${env.seed.usherEmail.split('@')[1]}`, usherHash, adminId]
  );
  const usher2 = u2Rows[0].id;

  // ---------- groups & locations ----------
  const groupNames = [
    'Choir',
    'Youth Fellowship',
    "Women's Fellowship",
    "Men's Fellowship",
    "Children's Ministry",
    'Ushering Department',
  ];
  const groups = {};
  for (const name of groupNames) {
    const { rows } = await db.query(
      `INSERT INTO member_groups (name) VALUES ($1) RETURNING id`,
      [name]
    );
    groups[name] = rows[0].id;
  }

  const locations = {};
  for (const name of ['Main Auditorium', 'Annex Hall', 'Online Service']) {
    const { rows } = await db.query(`INSERT INTO locations (name) VALUES ($1) RETURNING id`, [name]);
    locations[name] = rows[0].id;
  }

  // ---------- members ----------
  // [full name, group or null, hasEmail, gender]
  const memberDefs = [
    ['Abigail Mensah', 'Choir', true, 'female'],
    ['Benjamin Osei', "Men's Fellowship", true, 'male'],
    ['Chidinma Okafor', 'Youth Fellowship', true, 'female'],
    ['David Ampofo', 'Ushering Department', false, 'male'],
    ['Esther Boateng', "Women's Fellowship", true, 'female'],
    ['Felix Nkrumah', 'Youth Fellowship', false, 'male'],
    ['Grace Appiah', 'Choir', true, 'female'],
    ['Henry Owusu', "Men's Fellowship", false, 'male'],
    ['Irene Danso', "Children's Ministry", true, 'female'],
    ['James Quaye', 'Ushering Department', false, 'male'],
    ['Comfort Asante', "Women's Fellowship", true, 'female'],
    ['Kwame Sarpong', 'Youth Fellowship', false, 'male'],
    ['Lydia Addo', 'Choir', true, 'female'],
    ['Michael Tetteh', "Men's Fellowship", false, 'male'],
    ['Nana Adjei', 'Youth Fellowship', true, 'male'],
    ['Obiageli Eze', "Women's Fellowship", false, 'female'],
    ['Peter Antwi', 'Ushering Department', true, 'male'],
    ['Rebecca Owusuaa', "Children's Ministry", false, 'female'],
    ['Samuel Frimpong', "Men's Fellowship", true, 'male'],
    ['Theresa Nyarko', "Women's Fellowship", false, 'female'],
    ['Uche Nwachukwu', 'Youth Fellowship', false, 'male'],
    ['Victoria Lamptey', 'Choir', true, 'female'],
    ['William Darko', 'Ushering Department', false, 'male'],
    ['Yaa Konadu', "Women's Fellowship", true, 'female'],
    ['Zachary Boadi', 'Youth Fellowship', false, 'male'],
    ['Priscilla Agyeman', "Children's Ministry", true, 'female'],
    ['Joseph Mensimah', "Men's Fellowship", false, 'male'],
    ['Deborah Cudjoe', 'Choir', false, 'female'],
  ];

  const memberIds = [];
  let phoneSeq = 101;
  const today = new Date();
  for (const [fullName, groupName, hasEmail, gender] of memberDefs) {
    const slug = fullName.toLowerCase().replace(/[^a-z ]/g, '').split(/ +/).join('.');
    const { rows } = await db.query(
      `INSERT INTO members (full_name, email, phone, gender)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        fullName,
        hasEmail ? `${slug}@example.com` : null,
        `+1 555-01${phoneSeq++}`,
        gender,
      ]
    );
    const memberId = rows[0].id;
    memberIds.push(memberId);
    if (groupName) {
      await db.query(
        'INSERT INTO member_group_assignments (member_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [memberId, groups[groupName]]
      );
    }
  }

  // Demonstrate multi-group membership on a few members.
  const extraAssignments = [
    [memberIds[0], groups["Women's Fellowship"]],
    [memberIds[4], groups['Choir']],
    [memberIds[9], groups["Men's Fellowship"]],
  ];
  for (const [memberId, groupId] of extraAssignments) {
    await db.query(
      'INSERT INTO member_group_assignments (member_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [memberId, groupId]
    );
  }

  // Give a few members a birthday (a couple on today) so the greeting
  // preview can be demonstrated right after seeding.
  for (let i = 0; i < memberIds.length; i += 6) {
    const bd = new Date(today);
    bd.setFullYear(today.getFullYear() - 25 - (i % 20));
    bd.setMonth(today.getMonth());
    bd.setDate(today.getDate() + (i % 3)); // today, +1, +2
    await db.query('UPDATE members SET birthday = $1 WHERE id = $2', [fmtDate(bd), memberIds[i]]);
  }

  // Make three specific members inactive.
  await db.query(`UPDATE members SET status = 'inactive' WHERE id = ANY($1)`, [
    [memberIds[7], memberIds[15], memberIds[26]],
  ]);

  // ---------- services (10 weekly services ending today) ----------
  const serviceNames = [
    'Sunday Worship Service',
    'Communion Service',
    'Thanksgiving Service',
    'Family Service',
  ];
  const serviceIds = [];
  const serviceDates = [];
  for (let i = 9; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i * 7);
    const dateStr = fmtDate(d);
    const nameIdx = (9 - i) % serviceNames.length;
    const locName = nameIdx === 3 ? 'Annex Hall' : 'Main Auditorium';
    const { rows } = await db.query(
      `INSERT INTO services (service_date, service_name, start_time, location_id, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [dateStr, serviceNames[nameIdx], '09:30', locations[locName], adminId]
    );
    serviceIds.push(rows[0].id);
    serviceDates.push(dateStr);
  }

  // ---------- attendance (deterministic) ----------
  const recorders = [usher1, usher2, usher1, adminId];
  const absenceNotes = ['Travelling', 'Not feeling well', 'Work commitment', null];
  let recorderIdx = 0;
  for (let s = 0; s < serviceIds.length; s += 1) {
    let presentCount = 0;
    for (let m = 0; m < memberIds.length; m += 1) {
      const roll = rnd();
      const status = roll < 0.7 ? 'present' : roll < 0.88 ? 'absent' : 'excused';
      if (status === 'present') presentCount += 1;
      let note = null;
      if (status !== 'present' && rnd() < 0.35) {
        note = absenceNotes[Math.floor(rnd() * absenceNotes.length)];
      }
      const recorder = recorders[recorderIdx++ % recorders.length];
      await db.query(
        `INSERT INTO attendance
           (member_id, service_id, status, notes, recorded_by_user_id, updated_by_user_id, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $5, $6)
         ON CONFLICT (member_id, service_id) DO NOTHING`,
        [memberIds[m], serviceIds[s], status, note, recorder, `${serviceDates[s]} 10:15`]
      );
    }
    const headcount = presentCount + 3 + Math.floor(rnd() * 20);
    await db.query('UPDATE services SET total_headcount = $1 WHERE id = $2', [headcount, serviceIds[s]]);
  }

  // ---------- recompute streaks / last attended ----------
  for (const id of memberIds) {
    await recomputeMemberStats(db, id);
  }

  // ---------- follow-ups for members with repeated absences ----------
  const reasons = [
    'Moved to a new area',
    'Health challenges',
    'Shift work on Sundays',
    'Family commitments',
    'Needs a visit',
  ];
  const assignees = ['Pastoral Team', 'Mrs. Esther Boateng', 'Elder Henry Owusu'];
  const { rows: absentees } = await db.query(
    `SELECT id, consecutive_absences FROM members
      WHERE consecutive_absences >= 2 AND status = 'active'
      ORDER BY consecutive_absences DESC LIMIT 6`
  );
  for (const member of absentees) {
    const priority =
      member.consecutive_absences >= 4 ? 'high' : member.consecutive_absences >= 3 ? 'medium' : 'low';
    await db.query(
      `INSERT INTO follow_ups (member_id, absent_weeks, reason, priority, assigned_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        member.id,
        member.consecutive_absences,
        reasons[Math.floor(rnd() * reasons.length)],
        priority,
        assignees[Math.floor(rnd() * assignees.length)],
        adminId,
      ]
    );
  }

  console.log('');
  console.log('Seed complete! Demo accounts:');
  console.log(`  Admin : ${env.seed.adminEmail} / ${env.seed.adminPassword}`);
  console.log(`  Usher : ${env.seed.usherEmail} / ${env.seed.usherPassword}`);
  console.log(`  Usher : daniel@${env.seed.usherEmail.split('@')[1]} / same password as above`);

  // ---------- demo visitors ----------
  const newestService = await db.query('SELECT id FROM services ORDER BY service_date DESC LIMIT 1');
  const demoServiceId = newestService.rows[0].id;
  const demoVisitors = [
    ['Nana Ama Konadu', 'female', '+1 555-0701', 'adult', 'Agona, Ahanta West', 'Victoria Lamptey', 'I want to join the choir.'],
    ['Kojo Asante', 'male', '+1 555-0702', 'teen', 'Busua', 'Felix Nkrumah', null],
    ['Mabel Owusu', 'female', '+1 555-0703', 'adult', 'Dixcove', 'Esther Boateng', 'Pray for my family.'],
    ['Kwabena Osei', 'male', '+1 555-0704', 'child', 'Agona', 'Priscilla Agyeman', null],
  ];
  for (const [name, g, phone, age, area, invited, prayer] of demoVisitors) {
    const ins = await db.query(
      `INSERT INTO visitors (full_name, gender, phone, age_group, home_area, invited_by, prayer_request, service_id, first_visit_date, last_visit_date, created_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE, CURRENT_DATE, $9, 'Captured at the door by the usher team.')
       RETURNING id`,
      [name, g, phone, age, area, invited, prayer, demoServiceId, usher1]
    );
    await db.query(
      'INSERT INTO visitor_visits (visitor_id, service_id, visit_date, recorded_by) VALUES ($1, $2, CURRENT_DATE, $3)',
      [ins.rows[0].id, demoServiceId, usher1]
    );
  }
  console.log(`Members: ${memberIds.length}, Services: ${serviceIds.length}, Follow-up plans: ${absentees.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Seed failed:', e.message);
    process.exit(1);
  });