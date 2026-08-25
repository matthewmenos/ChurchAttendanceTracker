const express = require('express');
const db = require('../config/db');
const { ApiError, asyncHandler } = require('../utils/errors');
const { vStr, vInt, vBool } = require('../utils/validate');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getSettingsMap, PUBLIC_KEYS } = require('../services/settings');

const router = express.Router();

// Any signed-in user may read the public subset (church name, usher permissions).
router.get('/public', authenticate, asyncHandler(async (req, res) => {
  const all = await getSettingsMap(db);
  const out = {};
  for (const key of PUBLIC_KEYS) {
    if (all[key] !== undefined) out[key] = all[key];
  }
  res.json({ settings: out });
}));

router.get('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  res.json({ settings: await getSettingsMap(db) });
}));

router.put('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const updates = [];

  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'church_name')) {
    updates.push(['church_name', vStr(req.body, 'church_name', { required: true, min: 2, max: 80, label: 'Church name' })]);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'usher_can_correct_attendance')) {
    updates.push(['usher_can_correct_attendance', String(vBool(req.body, 'usher_can_correct_attendance', { required: true }))]);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'usher_correction_window_minutes')) {
    updates.push(['usher_correction_window_minutes', String(vInt(req.body, 'usher_correction_window_minutes', { required: true, min: 1, max: 1440, label: 'Correction window' }))]);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'show_member_contacts_to_ushers')) {
    updates.push(['show_member_contacts_to_ushers', String(vBool(req.body, 'show_member_contacts_to_ushers', { required: true }))]);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'birthday_messages_enabled')) {
    updates.push(['birthday_messages_enabled', String(vBool(req.body, 'birthday_messages_enabled', { required: true }))]);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'birthday_message_template')) {
    const tpl = vStr(req.body, 'birthday_message_template', { required: true, min: 2, max: 500, label: 'Birthday message template' });
    if (tpl && !/\{\{\s*first_name\s*\}\}/.test(tpl)) {
      throw new ApiError(400, 'The birthday template must include {{first_name}}.');
    }
    updates.push(['birthday_message_template', tpl]);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'notifications_enabled')) {
    updates.push(['notifications_enabled', String(vBool(req.body, 'notifications_enabled', { required: true }))]);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'visitor_thanks_enabled')) {
    updates.push(['visitor_thanks_enabled', String(vBool(req.body, 'visitor_thanks_enabled', { required: true }))]);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'visitor_thanks_template')) {
    const tpl = vStr(req.body, 'visitor_thanks_template', { required: true, min: 2, max: 500, label: 'Visitor thank-you template' });
    if (tpl && !/\{\{\s*first_name\s*\}\}/.test(tpl)) {
      throw new ApiError(400, 'The visitor thank-you template must include {{first_name}}.');
    }
    updates.push(['visitor_thanks_template', tpl]);
  }

  for (const [key, value] of updates) {
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value]
    );
  }
  res.json({ settings: await getSettingsMap(db), updated: updates.length });
}));

module.exports = router;