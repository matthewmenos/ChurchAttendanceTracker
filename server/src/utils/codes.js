/**
 * Human-friendly member codes for quick attendance marking at the door.
 * Ambiguous characters (0/O, 1/I/L) are excluded so codes read well aloud.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(len = 6) {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/** Generates an unused member code, checking the DB for collisions. */
async function generateMemberCode(db, len = 6) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomCode(len + attempt);
    const { rows } = await db.query('SELECT 1 FROM members WHERE member_code = $1', [code]);
    if (!rows.length) return code;
  }
  return randomCode(12);
}

module.exports = { randomCode, generateMemberCode, ALPHABET };