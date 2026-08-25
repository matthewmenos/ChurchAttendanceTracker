const express = require('express');
const { asyncHandler } = require('../utils/errors');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { runBirthdayJob, getBirthdayPreview } = require('../services/birthdays');

const router = express.Router();
// Birthday greetings are an admin concern: preview + manual trigger.
router.use(authenticate, requireAdmin);

/** Today's birthdays with the exact message each member would receive. */
router.get('/today', asyncHandler(async (req, res) => {
  res.json(await getBirthdayPreview());
}));

/** Run the send job now. Body {force:true} re-sends even if already recorded. */
router.post('/run', asyncHandler(async (req, res) => {
  const force = req.body && req.body.force === true;
  res.json(await runBirthdayJob({ force }));
}));

module.exports = router;
