const { ApiError } = require('../utils/errors');

const PUBLIC_KEYS = [
  'church_name',
  'logo',
  'usher_can_correct_attendance',
  'usher_correction_window_minutes',
  'show_member_contacts_to_ushers',
  'birthday_messages_enabled',
  'notifications_enabled',
];

async function getSettingsMap(db) {
  const { rows } = await db.query('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2 MB
const LOGO_MIME = /^image\/(png|jpeg|jpg|gif|svg\+xml)$/i;

/**
 * Validate a logo value submitted as a data URI (e.g. "data:image/png;base64,iVBOR...").
 * Returns the cleaned data URI or throws an ApiError.
 */
function validateLogo(value) {
  if (typeof value !== 'string') throw new ApiError(400, 'Logo must be a string.');
  const max = MAX_LOGO_SIZE;
  if (value.length > max * 2) throw new ApiError(400, `Logo must be at most ${max} bytes.`);
  const match = value.match(/^data:(image\/(png|jpeg|jpg|gif|svg\+xml));base64,(.+)$/i);
  if (!match) throw new ApiError(400, 'Logo must be a valid image data URI.');
  if (!LOGO_MIME.test('image/' + match[2])) {
    throw new ApiError(400, 'Unsupported logo image type.');
  }
  return value;
}

module.exports = { getSettingsMap, PUBLIC_KEYS, validateLogo, MAX_LOGO_SIZE };