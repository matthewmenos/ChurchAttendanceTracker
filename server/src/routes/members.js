const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vStr, vEmail, vInt, vEnum, vDate } = require('../utils/validate');
const { authenticate, requireAdmin, getBranchFilter, assertBranchAccess, requireDistrictAdmin } = require('../middleware/auth');
const { generateMemberCode } = require('../utils/codes');

const router = express.Router();

/**
 * Quick member add, used by the usher screen's "+" tab.
 * Ushers may only use this when their branch admin has switched on
 * "allow ushers to add members" for their branch; the new member always
 * joins the usher's own branch. Admins may use it too.
 * NOTE: registered before the admin-only router.use below on purpose.
 */
router.post('/quick-add', authenticate, asyncHandler(async (req, res) => {
  const isAdmin = ['district_admin', 'branch_admin'].includes(req.user.role);
  if (!isAdmin) {
    if (!req.user.branch_id) {
      throw new ApiError(403, 'Your account is not assigned to a branch, so you cannot add members.');
    }
    const { rows } = await db.query(
      `SELECT allow_usher_add_member FROM branches WHERE id = $1 AND status = 'active'`,
      [req.user.branch_id]
    );
    if (!rows[0] || !rows[0].allow_usher_add_member) {
      throw new ApiError(403, 'Your branch admin has not enabled member sign-up for ushers.');
    }
  }

  const fullName = vStr(req.body, 'fullName', { required: true, max: 120, label: 'Full name' });
  const phone = vStr(req.body, 'phone', { max: 40 });
  const gender = vEnum(req.body, 'gender', ['male', 'female'], { label: 'Gender' });
  const notes = vStr(req.body, 'notes', { max: 500 });

  // Ushers always add to their own branch; admins may pick one.
  let branchId = req.user.branch_id;
  if (req.user.role === 'district_admin' && req.body.branchId) {
    branchId = Number(req.body.branchId);
  }
  if (!branchId) {
    throw new ApiError(400, 'Cannot add member: no branch assigned. Please contact your administrator.');
  }

  try {
    const memberCode = await generateMemberCode(db);
    const { rows } = await db.query(
      `INSERT INTO members (full_name, phone, gender, status, notes, branch_id, member_code)
       VALUES ($1, $2, $3, 'active', $4, $5, $6)
       RETURNING id`,
      [fullName, phone || null, gender || null, notes || null, branchId, memberCode]
    );
    res.status(201).json({ member: cleanMember(await findMember(rows[0].id)) });
  } catch (e) {
    if (e.code === '23505') throw new ApiError(409, 'A member with this email already exists.');
    throw e;
  }
}));

// All member management is admin-only, enforced on the server.
router.use(authenticate, requireAdmin);

/** Whole years between a birthday and today (UTC). Returns null if unset/invalid. */
function ageFromBirthday(birthday) {
  if (!birthday) return null;
  const b = new Date(`${String(birthday).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(b.getTime())) return null;
  const today = new Date();
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday =
    d.getUTCMonth() < b.getUTCMonth() ||
    (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function cleanMember(m) {
  const groups = m.groups || [];
  return {
    id: m.id,
    full_name: m.full_name,
    email: m.email,
    phone: m.phone,
    branch_id: m.branch_id ?? null,
    branch_name: m.branch_name || null,
    member_code: m.member_code || null,
    birthday: m.birthday || null,
    age: m.age || null,
    gender: m.gender || null,
    membership_type: m.membership_type || null,
    marital_status: m.marital_status || null,
    profession: m.profession || null,
    residence: m.residence || null,
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
    `SELECT m.*, b.name AS branch_name, COALESCE((
         SELECT json_agg(json_build_object('id', g.id, 'name', g.name) ORDER BY g.name)
           FROM member_group_assignments mga
           JOIN member_groups g ON g.id = mga.group_id
          WHERE mga.member_id = m.id
       ), '[]'::json) AS groups
       FROM members m
       LEFT JOIN branches b ON b.id = m.branch_id
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
  const gender = vEnum(req.query, 'gender', ['male', 'female', 'all']) || 'all';
  const groupId = vInt(req.query, 'groupId');
  const page = Math.max(1, vInt(req.query, 'page') || 1);
  const pageSize = Math.min(1000, Math.max(1, vInt(req.query, 'pageSize') || 20));

  const where = [];
  const params = [];
  
  // Branch filtering
  const branchId = getBranchFilter(req);
  if (branchId) {
    params.push(branchId);
    where.push(`m.branch_id = $${params.length}`);
  }
  
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    where.push(`(m.full_name ILIKE $${n} OR COALESCE(m.email, '') ILIKE $${n} OR COALESCE(m.phone, '') ILIKE $${n})`);
  }
  if (status !== 'all') {
    params.push(status);
    where.push(`m.status = $${params.length}`);
  }
  if (gender !== 'all') {
    params.push(gender);
    where.push(`m.gender = $${params.length}`);
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
  const gender = vEnum(req.body, 'gender', ['male', 'female'], { label: 'Gender' });
  const membershipType = vEnum(req.body, 'membershipType', ['new_convert', 'existing'], { label: 'Membership type' });
  const maritalStatus = vEnum(req.body, 'maritalStatus', ['single', 'married', 'divorced', 'widowed'], { label: 'Marital status' });
  const profession = vStr(req.body, 'profession', { max: 200 });
  const residence = vStr(req.body, 'residence', { max: 200 });
  const groupIds = await ensureGroups(readGroupIds(req.body));
  const status = vEnum(req.body, 'status', ['active', 'inactive']) || 'active';
  const notes = vStr(req.body, 'notes', { max: 1000 });
  const age = ageFromBirthday(birthday);

  // Determine branch_id - use user's branch or allow district admin to specify
  let branchId = req.user.branch_id;
  if (req.user.role === 'district_admin' && req.body.branchId) {
    branchId = Number(req.body.branchId);
  }
  if (!branchId) {
    throw new ApiError(400, 'Cannot create member: no branch assigned. Please contact your administrator.');
  }

  try {
    // Every member gets a short door code for quick attendance marking.
    const memberCode = await generateMemberCode(db);
    const { rows } = await db.query(
      `INSERT INTO members (full_name, email, phone, birthday, age, gender, membership_type, marital_status, profession, residence, status, notes, branch_id, member_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [fullName, email, phone, birthday, age, gender, membershipType, maritalStatus, profession, residence, status, notes, branchId, memberCode]
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
  
  // Check branch access
  const branchId = getBranchFilter(req);
  if (branchId && member.branch_id !== branchId) {
    throw new ApiError(403, 'You do not have access to this member.');
  }
  
  res.json({ member: cleanMember(member) });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await findMember(id);
  if (!existing) throw new ApiError(404, 'Member not found.');
  
  // Check branch access
  const branchId = getBranchFilter(req);
  if (branchId && existing.branch_id !== branchId) {
    throw new ApiError(403, 'You do not have access to this member.');
  }

  const fullName = vStr(req.body, 'fullName', { required: true, max: 120, label: 'Full name' });
  const email = vEmail(req.body, 'email');
  const phone = vStr(req.body, 'phone', { max: 40 });
  const birthday = vDate(req.body, 'birthday');
  const gender = vEnum(req.body, 'gender', ['male', 'female'], { label: 'Gender' });
  const membershipType = vEnum(req.body, 'membershipType', ['new_convert', 'existing'], { label: 'Membership type' });
  const maritalStatus = vEnum(req.body, 'maritalStatus', ['single', 'married', 'divorced', 'widowed'], { label: 'Marital status' });
  const profession = vStr(req.body, 'profession', { max: 200 });
  const residence = vStr(req.body, 'residence', { max: 200 });
  const groupIds = await ensureGroups(readGroupIds(req.body));
  const status = vEnum(req.body, 'status', ['active', 'inactive']) || existing.status;
  const notes = vStr(req.body, 'notes', { max: 1000 });
  const age = ageFromBirthday(birthday);

  try {
    await db.query(
      `UPDATE members
          SET full_name = $1, email = $2, phone = $3, birthday = $4, age = $5, gender = $6,
              membership_type = $7, marital_status = $8, profession = $9, residence = $10,
              status = $11, notes = $12
        WHERE id = $13`,
      [fullName, email, phone, birthday, age, gender, membershipType, maritalStatus, profession, residence, status, notes, id]
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
  assertBranchAccess(req.user, existing.branch_id);
  await db.query('UPDATE members SET status = $1 WHERE id = $2', [status, id]);
  res.json({ member: cleanMember(await findMember(id)) });
}));

router.get('/:id/attendance', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const member = await findMember(id);
  if (!member) throw new ApiError(404, 'Member not found.');
  assertBranchAccess(req.user, member.branch_id);

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

/** Issue a new door code for this member; the old one stops working. */
router.post('/:id/regenerate-code', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const member = await findMember(id);
  if (!member) throw new ApiError(404, 'Member not found.');
  assertBranchAccess(req.user, member.branch_id);

  const code = await generateMemberCode(db);
  await db.query('UPDATE members SET member_code = $1 WHERE id = $2', [code, id]);
  res.json({ member: cleanMember(await findMember(id)) });
}));

/**
 * Move a member to another branch (district admin only).
 * Attendance history is kept; future marking happens at the new branch.
 */
router.post('/:id/transfer', requireDistrictAdmin, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const member = await findMember(id);
  if (!member) throw new ApiError(404, 'Member not found.');

  const branchId = vInt(req.body, 'branchId', { required: true, label: 'Branch' });
  const { rows: branchRows } = await db.query(
    `SELECT id, name FROM branches WHERE id = $1 AND status = 'active'`, [branchId]);
  if (!branchRows.length) {
    throw new ApiError(400, 'Invalid or inactive branch.', [
      { field: 'branchId', message: 'Unknown branch.' },
    ]);
  }
  if (member.branch_id === branchId) {
    throw new ApiError(400, 'The member already belongs to this branch.');
  }

  await db.query('UPDATE members SET branch_id = $1 WHERE id = $2', [branchId, id]);
  res.json({ member: cleanMember(await findMember(id)), transferred_to: branchRows[0].name });
}));

module.exports = router;