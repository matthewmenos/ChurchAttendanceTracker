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

function signRefreshToken(user) {
  const jti = crypto.randomUUID();
  // `sub` identifies the owner: the refresh route loads the account from it, so
  // a refresh token without it can never be redeemed (it would 401 as soon as
  // the access token lapsed). `jti` is the rotation handle.
  const token = jwt.sign({ sub: user.id, jti }, env.jwtRefreshSecret, {
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