const PUBLIC_KEYS = [
  'church_name',
  'usher_can_correct_attendance',
  'usher_correction_window_minutes',
  'show_member_contacts_to_ushers',
];

async function getSettingsMap(db) {
  const { rows } = await db.query('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

module.exports = { getSettingsMap, PUBLIC_KEYS };