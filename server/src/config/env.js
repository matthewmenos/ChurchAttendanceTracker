require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';
const isTest = nodeEnv === 'test';

const config = {
  nodeEnv,
  isTest,
  isProd: nodeEnv === 'production',
  port: Number(process.env.PORT || 4000),
  // Tests must never touch the dev database.
  databaseUrl: isTest
    ? process.env.DATABASE_URL_TEST || 'postgresql://postgres:postgres@127.0.0.1:5432/church_attendance_test'
    : process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/church_attendance',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || (isTest ? 'test-access-secret' : ''),
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || (isTest ? 'test-refresh-secret' : ''),
  accessTtlMinutes: Number(process.env.ACCESS_TOKEN_TTL_MINUTES || 15),
  refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS || 7),
  cookieSecure: String(process.env.COOKIE_SECURE || 'false') === 'true',
  // 'lax' for same-origin (Vercel monolith). Use 'none' only for split hosting.
  cookieSameSite: process.env.COOKIE_SAMESITE || 'lax',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || (isTest ? 4 : 10)),
  // Seed/demo credentials come ONLY from env - no defaults, ever.
  // 'npm run seed' aborts if these are missing.
  seed: {
    adminName: process.env.SEED_ADMIN_NAME || 'Main Admin',
    adminEmail: process.env.SEED_ADMIN_EMAIL || '',
    adminPassword: process.env.SEED_ADMIN_PASSWORD || '',
    usherName: process.env.SEED_USHER_NAME || 'Grace Usher',
    usherEmail: process.env.SEED_USHER_EMAIL || '',
    usherPassword: process.env.SEED_USHER_PASSWORD || '',
  },
};

if (config.isProd && (!config.jwtAccessSecret || !config.jwtRefreshSecret)) {
  throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are required in production.');
}

module.exports = config;