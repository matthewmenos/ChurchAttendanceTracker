const db = require('../config/db');
const { ApiError } = require('../utils/errors');
const { getSettingsMap } = require('./settings');
const { isArkaselConfigured, sendViaArkasel, renderTemplate } = require('./sms');

/** Active members with a phone number, filtered by group/gender. */
async function getAudience({ groupId, gender } = {}) {
  const where = [`m.status = 'active'`, `m.phone IS NOT NULL`, `COALESCE(m.phone, '') <> ''`];
  const params = [];
  if (groupId) {
    params.push(Number(groupId));
    where.push(`EXISTS (SELECT 1 FROM member_group_assignments mga WHERE mga.member_id = m.id AND mga.group_id = $${params.length})`);
  }
  if (gender === 'male' || gender === 'female') {
    params.push(gender);
    where.push(`m.gender = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT m.id, m.full_name, m.phone, m.gender
       FROM members m
      WHERE ${where.join(' AND ')}
      ORDER BY m.full_name ASC`,
    params
  );
  return rows;
}

async function recordNotification({ memberId, phone, message, category, status, providerResponse, createdBy }) {
  await db.query(
    `INSERT INTO sms_notifications (member_id, phone, message, category, status, provider_response, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [memberId, phone, message, category, status, providerResponse || null, createdBy || null]
  );
}

/**
 * Send a custom announcement/reminder to an audience over Arkasel SMS.
 * Never delivers unless Arkasel is configured AND notifications_enabled:
 * in that case every recipient is reported as 'dry-run' (nothing recorded).
 */
async function sendAnnouncement({ message, groupId, gender, category = 'announcement', createdBy } = {}) {
  const settings = await getSettingsMap(db);
  const enabled = settings.notifications_enabled !== 'false';
  const providerConfigured = isArkaselConfigured();
  const churchName = settings.church_name || '';

  const audience = await getAudience({ groupId, gender });
  const results = [];

  for (const member of audience) {
    const text = renderTemplate(message, { full_name: member.full_name, church_name: churchName });
    const base = { member_id: member.id, full_name: member.full_name, phone: member.phone };

    if (!enabled) {
      results.push({ ...base, message: text, status: 'skipped', detail: 'SMS notifications are disabled in Settings.' });
      continue;
    }
    if (!providerConfigured) {
      results.push({ ...base, message: text, status: 'dry-run', detail: 'Arkasel is not configured (ARKASEL_ENDPOINT / ARKASEL_API_KEY).' });
      continue;
    }

    try {
      const r = await sendViaArkasel(member.phone, text);
      const status = r.ok ? 'sent' : 'failed';
      await recordNotification({
        memberId: member.id,
        phone: member.phone,
        message: text,
        category,
        status,
        providerResponse: r.response,
        createdBy,
      });
      results.push({ ...base, message: text, status, detail: `Arkasel HTTP ${r.status}` });
    } catch (e) {
      await recordNotification({
        memberId: member.id,
        phone: member.phone,
        message: text,
        category,
        status: 'failed',
        providerResponse: e.message,
        createdBy,
      });
      results.push({ ...base, message: text, status: 'failed', detail: e.message });
    }
  }

  return {
    enabled,
    providerConfigured,
    total: audience.length,
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  };
}

/** Recent sends for the history table. */
async function listHistory(limit = 50) {
  const { rows } = await db.query(
    `SELECT n.id, n.member_id, n.phone, n.message, n.category, n.status, n.provider_response, n.created_at,
            m.full_name AS member_name
       FROM sms_notifications n
       JOIN members m ON m.id = n.member_id
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT $1`,
    [Math.min(200, Math.max(1, Number(limit) || 50))]
  );
  return rows;
}

module.exports = { getAudience, sendAnnouncement, listHistory };