/**
 * Automatic follow-up creation.
 *
 * When a member's consecutive_absences reaches the configured threshold
 * (settings.followup_absent_threshold, 0 = disabled), they are added to the
 * follow-up list with an open, auto-created record. Only one open follow-up is
 * kept per member — closing it lets a fresh one be created if they lapse again.
 */
const db = require('../config/db');
const { getSettingsMap } = require('./settings');

const DEFAULT_THRESHOLD = 3;

async function readThreshold(instance) {
  const settings = await getSettingsMap(instance || db);
  const raw = Number(settings.followup_absent_threshold);
  const threshold = Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_THRESHOLD;
  return threshold >= 1 ? threshold : 0; // 0 = disabled
}

async function syncFollowUpForMember(instance, memberId, opts = {}) {
  const threshold = opts.threshold !== undefined ? opts.threshold : await readThreshold(instance);
  if (!threshold) return { created: false, reason: 'disabled' };

  const { rows } = await instance.query(
    `SELECT id, full_name, consecutive_absences, last_attended
       FROM members
      WHERE id = $1 AND status = 'active'`,
    [memberId]
  );
  const member = rows[0];
  if (!member) return { created: false, reason: 'not-active' };
  if (member.consecutive_absences < threshold) return { created: false, reason: 'below-threshold' };

  const { rows: open } = await instance.query(
    `SELECT id FROM follow_ups WHERE member_id = $1 AND status = 'open' LIMIT 1`,
    [memberId]
  );
  if (open.length) return { created: false, reason: 'already-open' };

  const priority = member.consecutive_absences >= threshold + 2 ? 'high' : 'medium';
  const { rows: inserted } = await instance.query(
    `INSERT INTO follow_ups (member_id, absent_weeks, last_seen, reason, priority, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      memberId,
      member.consecutive_absences,
      member.last_attended || null,
      `Auto-created after ${member.consecutive_absences} consecutive absences (threshold ${threshold}).`,
      priority,
      opts.createdBy || null,
    ]
  );
  return { created: true, followUpId: inserted[0].id, memberId, streak: member.consecutive_absences, priority };
}

/** Scan every active member and create follow-ups for those past the threshold. */
async function syncFollowUps(instance, opts = {}) {
  const threshold = opts.threshold !== undefined ? opts.threshold : await readThreshold(instance);
  if (!threshold) return { threshold: 0, disabled: true, created: [] };

  const { rows } = await instance.query(
    `SELECT id FROM members WHERE status = 'active' AND consecutive_absences >= $1`,
    [threshold]
  );
  const created = [];
  for (const m of rows) {
    const r = await syncFollowUpForMember(instance, m.id, { threshold, createdBy: opts.createdBy });
    if (r.created) created.push(r);
  }
  return { threshold, disabled: false, created };
}

module.exports = { readThreshold, syncFollowUpForMember, syncFollowUps };
