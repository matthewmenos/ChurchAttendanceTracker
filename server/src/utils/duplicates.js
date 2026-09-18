/**
 * Pure duplicate-member logic: field normalisation + the "2 of 3" rule.
 *
 * A member is considered a duplicate of an existing one when at least 2 of
 * the 3 identifying fields (full name, birthday, phone) match. These helpers
 * are framework- and DB-free so they can be unit-tested in isolation; the
 * members route uses them to build its scoring query and to label which
 * fields matched.
 */

/** Lowercase, trimmed, inner whitespace collapsed - or null. */
function normalizeName(raw) {
  if (!raw) return null;
  const n = String(raw).trim().replace(/\s+/g, ' ').toLowerCase();
  return n || null;
}

/**
 * Digits only. Compares the LAST 9 digits so '0244 123 456' and
 * '+233 244 123 456' are seen as the same number. Fewer than 7 digits is
 * treated as "no phone" rather than a risky partial comparison.
 */
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D+/g, '');
  if (digits.length < 7) return null;
  return digits.length > 9 ? digits.slice(-9) : digits;
}

/** pg DATE columns arrive as JS Dates; normalise back to YYYY-MM-DD. */
function toISODate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Which of the three fields match between the input and an existing member. */
function matchedCriteria(input, existing) {
  const on = [];
  const inName = normalizeName(input.fullName);
  if (inName && normalizeName(existing.full_name) === inName) on.push('name');
  const inPhone = normalizePhone(input.phone);
  if (inPhone && normalizePhone(existing.phone) === inPhone) on.push('phone');
  const inBirthday = input.birthday || null;
  if (inBirthday && toISODate(existing.birthday) === inBirthday) on.push('birthday');
  return on;
}

/** Number of identifying fields shared by the input and an existing member. */
function countMatches(input, existing) {
  return matchedCriteria(input, existing).length;
}

module.exports = { normalizeName, normalizePhone, toISODate, matchedCriteria, countMatches };
