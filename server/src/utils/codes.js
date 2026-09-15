/**
 * Member PINs for quick attendance marking at the door.
 * Four digits, numbers only (0000-9999), stored as TEXT so leading
 * zeros (e.g. "0123") are preserved.
 */
const ALPHABET = '0123456789';
const PIN_LENGTH = 4;
const PIN_RE = /^\d{4}$/;

function randomCode(len = PIN_LENGTH) {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/** Generates an unused 4-digit PIN, checking the DB for collisions. */
async function generateMemberCode(db) {
  // 10k possibilities is plenty for a church, but random draws can collide
  // as the space fills - retry generously before giving up.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const code = randomCode(PIN_LENGTH);
    const { rows } = await db.query('SELECT 1 FROM members WHERE member_code = $1', [code]);
    if (!rows.length) return code;
  }
  throw new Error('No unused 4-digit PINs available.');
}

module.exports = { randomCode, generateMemberCode, ALPHABET, PIN_LENGTH, PIN_RE };