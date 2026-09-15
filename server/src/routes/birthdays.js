const express = require('express');
const { asyncHandler } = require('../utils/errors');
const { authenticate, requireDistrictAdmin } = require('../middleware/auth');
const { runBirthdayJob, getBirthdayPreview } = require('../services/birthdays');

const router = express.Router();
// Birthday greetings are a church-wide concern: preview + manual trigger are
// reserved for the district admin.
router.use(authenticate, requireDistrictAdmin);

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
