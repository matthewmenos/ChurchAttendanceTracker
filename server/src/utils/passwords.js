const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const env = require('../config/env');

async function hashPassword(plain) {
  return bcrypt.hash(plain, env.bcryptRounds);
}

async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(plain || ''), hash);
}

/** Readable one-time temporary password, e.g. Kp7m-Rw2t-Qx9z */
function generateTempPassword() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

module.exports = { hashPassword, verifyPassword, generateTempPassword };