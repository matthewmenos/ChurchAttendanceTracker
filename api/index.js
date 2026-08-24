// Vercel Serverless Function entry:
// every /api/* request is handled by the Express app.
// On the first invocation of each instance we also self-bootstrap:
//   1. apply any pending database migrations (idempotent),
//   2. create the very first admin account when configured via env vars
//      (ADMIN_EMAIL / ADMIN_PASSWORD, only if the users table is empty).
const { createApp } = require('../server/src/app');
const env = require('../server/src/config/env');
const db = require('../server/src/config/db');
const { runMigrations } = require('../server/scripts/migrate');
const { hashPassword } = require('../server/src/utils/passwords');

const app = createApp();

let bootstrapPromise = null;

async function bootstrap() {
  await runMigrations(env.databaseUrl);

  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) {
    console.log('Admin bootstrap skipped: ADMIN_EMAIL / ADMIN_PASSWORD are not set.');
    return;
  }
  if (password.length < 8) {
    console.error('ADMIN_PASSWORD ignored: must be at least 8 characters.');
    return;
  }

  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) {
    console.log(`Admin bootstrap skipped: ${rows[0].n} user(s) already exist.`);
    return;
  }

  await db.query(
    `INSERT INTO users (name, email, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, 'admin', TRUE)
     ON CONFLICT (email) DO NOTHING`,
    [process.env.ADMIN_NAME || 'Main Admin', email, await hashPassword(password)]
  );
  console.log(`Bootstrap admin created for ${email} (password change required at first login).`);
}

function getBootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap().catch((err) => {
      console.error('Startup bootstrap failed; will retry on next request:', err.message);
      bootstrapPromise = null;
      throw err;
    });
  }
  return bootstrapPromise;
}

module.exports = async (req, res) => {
  const pathOnly = String(req.url || '').split('?')[0];
  const isHealth = req.method === 'GET' && pathOnly === '/api/health';

  if (!isHealth) {
    try {
      await getBootstrap();
    } catch (e) {
      return res.status(503).json({ message: 'Service is initializing. Please retry in a moment.' });
    }
  }
  return app(req, res);
};