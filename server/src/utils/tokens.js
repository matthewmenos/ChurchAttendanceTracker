const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.jwtAccessSecret, {
    expiresIn: `${env.accessTtlMinutes}m`,
  });
}

function signRefreshToken() {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ jti }, env.jwtRefreshSecret, {
    expiresIn: `${env.refreshTokenTtlDays}d`,
  });
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  return { token, jti, expiresAt };
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtAccessSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwtRefreshSecret);
}

module.exports = { sha256, signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };