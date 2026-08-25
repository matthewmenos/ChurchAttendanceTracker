const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vStr, vInt, vEmail, vEnum, vDate } = require('../utils/validate');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { createVisitor, listVisitors, updateVisitor, convertToMember, visitorStats } = require('../services/visitors');

const router = express.Router();

// Ushers (and admins) may add visitors and view the ones for a service.
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const serviceId = vInt(req.body, 'serviceId', { label: 'Service' });
  if (serviceId) {
    const svc = await db.query('SELECT id FROM services WHERE id = $1', [serviceId]);
    if (!svc.rows.length) throw new ApiError(400, 'Service not found.');
  }
  const fullName = vStr(req.body, 'fullName', { required: true, max: 120, label: 'Visitor name' });
  const gender = vEnum(req.body, 'gender', ['male', 'female']);
  const phone = vStr(req.body, 'phone', { max: 40 });
  const email = vEmail(req.body, 'email');
  const ageGroup = vEnum(req.body, 'ageGroup', ['child', 'teen', 'adult']);
  const homeArea = vStr(req.body, 'homeArea', { max: 120 });
  const invitedBy = vStr(req.body, 'invitedBy', { max: 120 });
  const prayerRequest = vStr(req.body, 'prayerRequest', { max: 1000 });
  const notes = vStr(req.body, 'notes', { max: 1000 });

  const result = await createVisitor({
    fullName, gender, phone, email, ageGroup, homeArea, invitedBy, prayerRequest,
    serviceId: serviceId || undefined, createdBy: req.user.id, notes,
  });
  res.status(201).json(result);
}));

// Ushers can list visitors captured for the service they are marking,
// or every visitor they personally captured (mine=1).
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const serviceId = vInt(req.query, 'serviceId');
  const mine = ['1', 'true'].includes(String(req.query.mine));
  if (!isAdmin && !serviceId && !mine) throw new ApiError(400, 'Pass a serviceId or mine=1 to list visitors.');
  const result = await listVisitors({
    serviceId: serviceId || undefined,
    createdBy: mine ? req.user.id : undefined,
    followupStatus: vEnum(req.query, 'followupStatus', ['new', 'contacted', 'visited', 'joined', 'lost']),
    search: vStr(req.query, 'search', { max: 100 }) || undefined,
    page: vInt(req.query, 'page') || 1,
    pageSize: vInt(req.query, 'pageSize') || 20,
  });
  res.json(result);
}));

// Admin-only management below.
router.use(requireAdmin);

router.get('/stats', asyncHandler(async (req, res) => {
  res.json({ items: await visitorStats({ from: vDate(req.query, 'from'), to: vDate(req.query, 'to') }) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { findVisitor } = require('../services/visitors');
  const visitor = await findVisitor(Number(req.params.id));
  if (!visitor) throw new ApiError(404, 'Visitor not found.');
  res.json({ visitor });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { followupStatus, gender, ageGroup } = req.body || {};
  const allowed = ['new', 'contacted', 'visited', 'joined', 'lost'];
  if (followupStatus !== undefined && !allowed.includes(followupStatus)) {
    throw new ApiError(400, 'Unknown follow-up status.');
  }
  if (gender !== undefined && gender !== null && !['male', 'female'].includes(gender)) {
    throw new ApiError(400, 'Gender must be male or female.');
  }
  if (ageGroup !== undefined && ageGroup !== null && !['child', 'teen', 'adult'].includes(ageGroup)) {
    throw new ApiError(400, 'Age group must be child, teen or adult.');
  }
  const visitor = await updateVisitor(Number(req.params.id), req.body || {});
  res.json({ visitor });
}));

router.post('/:id/convert', asyncHandler(async (req, res) => {
  const result = await convertToMember(Number(req.params.id));
  res.json(result);
}));

module.exports = router;