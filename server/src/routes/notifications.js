const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vStr, vInt, vEnum } = require('../utils/validate');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getSettingsMap } = require('../services/settings');
const { isArkaselConfigured } = require('../services/sms');
const { getAudience, sendAnnouncement, listHistory } = require('../services/notifications');

const router = express.Router();
router.use(authenticate, requireAdmin);

/** Recipient preview + provider status for the composer. */
router.get('/audience', asyncHandler(async (req, res) => {
  const groupId = vInt(req.query, 'groupId');
  const gender = vEnum(req.query, 'gender', ['male', 'female']);
  const members = await getAudience({ groupId, gender });
  res.json({
    count: members.length,
    providerConfigured: isArkaselConfigured(),
    enabled: (await getSettingsMap(db)).notifications_enabled !== 'false',
  });
}));

/** Upcoming services for the reminder helper in the composer. */
router.get('/upcoming-services', asyncHandler(async (req, res) => {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const { rows } = await db.query(
    `SELECT id, service_date, service_name, start_time
       FROM services
      WHERE service_date >= $1
      ORDER BY service_date ASC, start_time ASC NULLS LAST
      LIMIT 10`,
    [todayStr]
  );
  res.json({ items: rows });
}));

/** Compose + send an SMS announcement/reminder to an audience. */
router.post('/send', asyncHandler(async (req, res) => {
  const message = vStr(req.body, 'message', { required: true, min: 2, max: 480, label: 'Message' });
  const groupId = vInt(req.body, 'groupId');
  if (groupId) {
    const { rows } = await db.query('SELECT id FROM member_groups WHERE id = $1', [groupId]);
    if (!rows.length) throw new ApiError(400, 'The selected group does not exist.');
  }
  const gender = vEnum(req.body, 'gender', ['male', 'female']);
  const category = vEnum(req.body, 'category', ['announcement', 'reminder']) || 'announcement';

  const summary = await sendAnnouncement({
    message,
    groupId,
    gender,
    category,
    createdBy: req.user.id,
  });
  res.json(summary);
}));

/** Recent sends (history table). */
router.get('/history', asyncHandler(async (req, res) => {
  const limit = Math.min(200, Math.max(1, vInt(req.query, 'limit') || 50));
  res.json({ items: await listHistory(limit) });
}));

module.exports = router;