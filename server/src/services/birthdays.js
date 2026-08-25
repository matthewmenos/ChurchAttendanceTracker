const db = require('../config/db');
const env = require('../config/env');
const { getSettingsMap } = require('./settings');

/** Whole years between birthday and the given day. */
function ageOn(birthday, on) {
  if (!birthday) return null;
  const b = new Date(`${String(birthday).slice(0, 10)}T00:00:00Z`);
  const d = new Date(`${String(on).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(b.getTime()) || Number.isNaN(d.getTime())) return null;
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday =
    d.getUTCMonth() < b.getUTCMonth() ||
    (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** Replace {{first_name}} {{full_name}} {{age}} {{church_name}} placeholders. */
function renderMessage(template, member, churchName, today) {
  const age = ageOn(member.birthday, today);
  return String(template || '')
    .replace(/{{\s*first_name\s*}}/gi, member.full_name.split(' ')[0])
    .replace(/{{\s*full_name\s*}}/gi, member.full_name)
    .replace(/{{\s*age\s*}}/gi, age === null ? '' : String(age))
    .replace(/{{\s*church_name\s*}}/gi, churchName || '')
    .trim();
}

/** Active members whose birthday (month + day) falls on `today`. */
async function getTodaysBirthdays(today = new Date()) {
  const { rows } = await db.query(
    `SELECT id, full_name, phone, birthday
       FROM members
      WHERE status = 'active' AND birthday IS NOT NULL
        AND EXTRACT(MONTH FROM birthday) = $1
        AND EXTRACT(DAY FROM birthday) = $2
      ORDER BY full_name ASC`,
    [today.getMonth() + 1, today.getDate()]
  );
  return rows;
}

/**
 * Arkasel HTTP SMS contract (configurable via env):
 *   POST {ARKASEL_ENDPOINT}
 *   Headers: {Content-Type: application/json,
 *             <ARKASEL_AUTH_HEADER>: <ARKASEL_AUTH_SCHEME><ARKASEL_API_KEY>}
 *   Body:    {sender, to, message}
 * A 2xx response counts as delivered. Adjust ARKASEL_AUTH_HEADER /
 * ARKASEL_AUTH_SCHEME if the gateway expects a different auth style.
 */
async function sendViaArkasel(phone, message) {
  const { endpoint, apiKey, senderId, authHeader, authScheme } = env.arkasel;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers[authHeader] = `${authScheme}${apiKey}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sender: senderId, to: phone, message }),
  });
  const response = (await res.text().catch(() => '')).slice(0, 500);
  return { ok: res.ok, status: res.status, response };
}

async function recordBirthdayMessage({ memberId, year, phone, message, status, providerResponse }) {
  await db.query(
    `INSERT INTO birthday_messages (member_id, year, phone, message, status, provider_response)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (member_id, year) DO UPDATE
        SET phone = EXCLUDED.phone,
            message = EXCLUDED.message,
            status = EXCLUDED.status,
            provider_response = EXCLUDED.provider_response,
            created_at = now()`,
    [memberId, year, phone, message, status, providerResponse || null]
  );
}

/**
 * Send (or preview) today's birthday messages.
 * Never delivers unless Arkasel is configured AND birthday_messages_enabled.
 * Only 'sent'/'failed' attempts are recorded, so a dry-run never blocks a
 * future real send for the same member and year.
 */
async function runBirthdayJob({ today = new Date(), force = false } = {}) {
  const settings = await getSettingsMap(db);
  const enabled = settings.birthday_messages_enabled === 'true';
  const template = settings.birthday_message_template || 'Happy birthday {{first_name}}!';
  const churchName = settings.church_name || '';
  const providerConfigured = Boolean(env.arkasel.endpoint && env.arkasel.apiKey);

  const members = await getTodaysBirthdays(today);
  const year = today.getFullYear();
  const dateStr = today.toISOString().slice(0, 10);
  const results = [];

  for (const member of members) {
    const message = renderMessage(template, member, churchName, today);
    const base = { member_id: member.id, full_name: member.full_name, phone: member.phone, message };

    if (!enabled) {
      results.push({ ...base, status: 'skipped', detail: 'Birthday messages are disabled in Settings.' });
      continue;
    }
    if (!force) {
      const { rows: existing } = await db.query(
        'SELECT status FROM birthday_messages WHERE member_id = $1 AND year = $2',
        [member.id, year]
      );
      if (existing.length) {
        results.push({ ...base, status: existing[0].status, detail: 'Already processed for this year.' });
        continue;
      }
    }
    if (!member.phone) {
      results.push({ ...base, status: 'skipped', detail: 'Member has no phone number on file.' });
      continue;
    }
    if (!providerConfigured) {
      results.push({ ...base, status: 'dry-run', detail: 'Arkasel is not configured (ARKASEL_ENDPOINT / ARKASEL_API_KEY).' });
      continue;
    }

    try {
      const r = await sendViaArkasel(member.phone, message);
      const status = r.ok ? 'sent' : 'failed';
      await recordBirthdayMessage({ memberId: member.id, year, phone: member.phone, message, status, providerResponse: r.response });
      results.push({ ...base, status, detail: `Arkasel HTTP ${r.status}` });
    } catch (e) {
      await recordBirthdayMessage({ memberId: member.id, year, phone: member.phone, message, status: 'failed', providerResponse: e.message });
      results.push({ ...base, status: 'failed', detail: e.message });
    }
  }

  return {
    date: dateStr,
    enabled,
    providerConfigured,
    total: members.length,
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  };
}

/** Preview for the admin UI: today's birthdays with their rendered message. */
async function getBirthdayPreview(today = new Date()) {
  const settings = await getSettingsMap(db);
  const template = settings.birthday_message_template || 'Happy birthday {{first_name}}!';
  const churchName = settings.church_name || '';
  const year = today.getFullYear();
  const members = await getTodaysBirthdays(today);
  const { rows: processed } = await db.query(
    'SELECT member_id, status FROM birthday_messages WHERE year = $1',
    [year]
  );
  const processedMap = new Map(processed.map((p) => [p.member_id, p.status]));
  return {
    date: today.toISOString().slice(0, 10),
    enabled: settings.birthday_messages_enabled === 'true',
    providerConfigured: Boolean(env.arkasel.endpoint && env.arkasel.apiKey),
    members: members.map((m) => ({
      id: m.id,
      full_name: m.full_name,
      phone: m.phone,
      birthday: m.birthday,
      age: ageOn(m.birthday, today),
      message: renderMessage(template, m, churchName, today),
      status: processedMap.get(m.id) || null,
    })),
  };
}

module.exports = { runBirthdayJob, getBirthdayPreview, renderMessage, ageOn, getTodaysBirthdays };

