const express = require('express');
const db = require('../config/db');
const { getSettingsMap } = require('../services/settings');

const router = express.Router();

// Health check (works even when the database is unreachable).
router.get('/health', async (req, res) => {
  let dbStatus = 'up';
  try {
    await db.query('SELECT 1');
  } catch (e) {
    dbStatus = 'down';
  }
  res.json({
    status: dbStatus === 'up' ? 'ok' : 'degraded',
    db: dbStatus,
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// No public registration endpoint exists on purpose:
// only admins create accounts via POST /api/users.
router.get('/branding', async (req, res) => {
  try {
    const s = await getSettingsMap(db);
    res.json({ churchName: s.church_name || 'COP Agona Ahanta' });
  } catch (e) {
    res.json({ churchName: 'COP Agona Ahanta' });
  }
});
router.use('/auth', require('./auth'));
router.use('/users', require('./users'));
router.use('/members', require('./members'));
router.use('/services', require('./services'));
router.use('/attendance', require('./attendance'));
router.use('/groups', require('./groups'));
router.use('/locations', require('./locations'));
router.use('/followups', require('./followups'));
router.use('/reports', require('./reports'));
router.use('/settings', require('./settings'));

module.exports = router;