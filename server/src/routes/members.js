const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vStr, vEmail, vInt, vEnum, vDate } = require('../utils/validate');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
// All member management is admin-only, enforced on the server.
router.use(authenticate, requireAdmin);

function cleanMember(m) {
  const groups = m.groups || [];
  return {
    id: m.id,
    full_name: m.full_name,
    email: m.email,
    phone: m.phone,
    birthday: m.birthday || null,
    groups,
    group_ids: groups.map((g) => g.id),
    status: m.status,
    last_attended: m.last_attended,
    consecutive_absences: m.consecutive_absences,
    notes: m.notes,
    created_at: m.created_at,
    updated_at: m.updated_at,
  };
}

async function findMember(id) {
  const { rows } = await db.query(
    `SELECT m.*, COALESCE((
         SELECT json_agg(json_build_object('id', g.id, 'name', g.name) ORDER BY g.name)
           FROM member_group_assignments mga
           JOIN member_groups g ON g.id = mga.group_id
          WHERE mga.member_id = m.id
       ), '[]'::json) AS groups
       FROM members m
      WHERE m.id = $1`,
    [id]
  );
  return rows[0];
}

function readGroupIds(body) {
  const raw = body ? body.groupIds : undefined;
  if (raw === undefined || raw === null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
}

async function ensureGroups(groupIds) {
  const ids = [...new Set(groupIds)];
  if (!ids.length) return ids;
  const { rows } = await db.query('SELECT id FROM member_groups WHERE id = ANY($1)', [ids]);
  if (rows.length !== ids.length) {
    throw new ApiError(400, 'One or more selected groups do not exist.', [
      { field: 'groupIds', message: 'Unknown group.' },
    ]);
  }
  return ids;
}

async function setMemberGroups(memberId, groupIds) {
  await db.query('DELETE FROM member_group_assignments WHERE member_id = $1', [memberId]);
  for (const gid of groupIds) {
    await db.query(
      'INSERT INTO member_group_assignments (member_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [memberId, gid]
    );
  }
}

router.get('/', asyncHandler(async (req, res) => {
  const search = vStr(req.query, 'search', { max: 100 }) || '';
  const status = vEnum(req.query, 'status', ['active', 'inactive', 'all']) || 'all';
  const groupId = vInt(req.query, 'groupId');
  const page = Math.max(1, vInt(req.query, 'page') || 1);
  const pageSize = Math.min(1000, Math.max(1, vInt(req.query, 'pageSize') || 20));

  const where = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    where.push(`(m.full_name ILIKE $${n} OR COALESCE(m.email, '') ILIKE $${n} OR COALESCE(m.phone, '') ILIKE $${n})`);
  }
  if (status !== 'all') {
    params.push(status);
    where.push(`m.status = $${params.length}`);
  }
  if (groupId) {
    params.push(groupId);
    where.push(`EXISTS (SELECT 1 FROM member_group_assignments mga WHERE mga.member_id = m.id AND mga.group_id = $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT m.*, COALESCE((
         SELECT json_agg(json_build_object('id', g.id, 'name', g.name) ORDER BY g.name)
           FROM member_group_assignments mga
           JOIN member_groups g ON g.id = mga.group_id
          WHERE mga.member_id = m.id
       ), '[]'::json) AS groups
       FROM members m
       ${whereSql}
      ORDER BY m.full_name ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params
  );
  const { rows: countRows } = await db.query(
    `SELECT COUNT(*) AS n FROM members m ${whereSql}`, params
  );
  res.json({ items: rows.map(cleanMember), total: Number(countRows[0].n), page, pageSize });
}));

router.post('/', asyncHandler(async (req, res) => {
  const fullName = vStr(req.body, 'fullName', { required: true, max: 120, label: 'Full name' });
  const email = vEmail(req.body, 'email');
  const phone = vStr(req.body, 'phone', { max: 40 });
  const birthday = vDate(req.body, 'birthday');
  const groupIds = await ensureGroups(readGroupIds(req.body));
  const status = vEnum(req.body, 'status', ['active', 'inactive']) || 'active';
  const notes = vStr(req.body, 'notes', { max: 1000 });

  try {
    const { rows } = await db.query(
      `INSERT INTO members (full_name, email, phone, birthday, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [fullName, email, phone, birthday, status, notes]
    );
    await setMemberGroups(rows[0].id, groupIds);
    res.status(201).json({ member: cleanMember(await findMember(rows[0].id)) });
  } catch (e) {
    if (e.code === '23505') throw new ApiError(409, 'A member with this email already exists.');
    throw e;
  }
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const member = await findMember(Number(req.params.id));
  if (!member) throw new ApiError(404, 'Member not found.');
  res.json({ member: cleanMember(member) });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await findMember(id);
  if (!existing) throw new ApiError(404, 'Member not found.');

  const fullName = vStr(req.body, 'fullName', { required: true, max: 120, label: 'Full name' });
  const email = vEmail(req.body, 'email');
  const phone = vStr(req.body, 'phone', { max: 40 });
  const birthday = vDate(req.body, 'birthday');
  const groupIds = await ensureGroups(readGroupIds(req.body));
  const status = vEnum(req.body, 'status', ['active', 'inactive']) || existing.status;
  const notes = vStr(req.body, 'notes', { max: 1000 });

  try {
    await db.query(
      `UPDATE members
          SET full_name = $1, email = $2, phone = $3, birthday = $4, status = $5, notes = $6
        WHERE id = $7`,
      [fullName, email, phone, birthday, status, notes, id]
    );
    await setMemberGroups(id, groupIds);
    res.json({ member: cleanMember(await findMember(id)) });
  } catch (e) {
    if (e.code === '23505') throw new ApiError(409, 'Another member already uses this email.');
    throw e;
  }
}));

router.patch('/:id/status', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const status = vEnum(req.body, 'status', ['active', 'inactive'], { required: true });
  const existing = await findMember(id);
  if (!existing) throw new ApiError(404, 'Member not found.');
  await db.query('UPDATE members SET status = $1 WHERE id = $2', [status, id]);
  res.json({ member: cleanMember(await findMember(id)) });
}));

router.get('/:id/attendance', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const member = await findMember(id);
  if (!member) throw new ApiError(404, 'Member not found.');

  const { rows: items } = await db.query(
    `SELECT a.id, a.status, a.notes, a.recorded_at, a.updated_at,
            s.id AS service_id, s.service_date, s.service_name,
            ru.name AS recorded_by_name, uu.name AS updated_by_name
       FROM attendance a
       JOIN services s ON s.id = a.service_id
       LEFT JOIN users ru ON ru.id = a.recorded_by_user_id
       LEFT JOIN users uu ON uu.id = a.updated_by_user_id
      WHERE a.member_id = $1
      ORDER BY s.service_date DESC, a.updated_at DESC
      LIMIT 300`,
    [id]
  );
  const { rows: t } = await db.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'present') AS p,
            COUNT(*) FILTER (WHERE status = 'absent')  AS ab,
            COUNT(*) FILTER (WHERE status = 'excused') AS ex
       FROM attendance WHERE member_id = $1`,
    [id]
  );
  res.json({
    member: cleanMember(member),
    summary: { present: Number(t[0].p), absent: Number(t[0].ab), excused: Number(t[0].ex) },
    items,
  });
}));

module.exports = router;