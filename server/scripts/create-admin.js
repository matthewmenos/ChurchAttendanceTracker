/**
 * Creates or resets a single admin account — use this to bootstrap
 * a production database without seeding demo data.
 *
 *   node scripts/create-admin.js "Pastor Kwesi Mensah" "admin@copagonaahanta.app" "StrongPass123"
 *   (or set ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD env vars)
 *
 * Optionally set ADMIN_USERNAME so the admin can sign in with a username
 * instead of their email (same rules as the Vercel bootstrap: 3-40 letters,
 * numbers, dots, hyphens or underscores; must be unique).
 */
const db = require('../src/config/db');
const { hashPassword } = require('../src/utils/passwords');

async function main() {
  const name = process.argv[2] || process.env.ADMIN_NAME || 'Main Admin';
  const email = String(process.argv[3] || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.argv[4] || process.env.ADMIN_PASSWORD || '';

  if (!email || !password) {
    console.log('Usage: node scripts/create-admin.js "<Name>" "<email>" "<password>"');
    console.log('   or set ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD env vars.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  // Optional sign-in username, validated exactly like api/index.js bootstrap.
  const rawUsername = String(process.env.ADMIN_USERNAME || '').trim();
  const username = /^[A-Za-z0-9._-]{3,40}$/.test(rawUsername) ? rawUsername : '';
  if (rawUsername && !username) {
    console.error('ADMIN_USERNAME ignored: use 3-40 letters, numbers, dots, hyphens or underscores.');
  }

  // Refuse usernames that already belong to a different account.
  if (username) {
    const { rows: taken } = await db.query(
      'SELECT id FROM users WHERE lower(username) = lower($1) AND lower(email) <> lower($2)',
      [username, email]
    );
    if (taken.length) {
      console.error(`ADMIN_USERNAME "${username}" is already taken by another account.`);
      process.exit(1);
    }
  }

  const hash = await hashPassword(password);
  const { rows } = await db.query(
    `INSERT INTO users (name, email, username, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, $4, 'admin', TRUE)
     ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            role = 'admin',
            status = 'active',
            must_change_password = TRUE,
            username = COALESCE(EXCLUDED.username, users.username)
     RETURNING id`,
    [name, email, username || null, hash]
  );
  const suffix = username ? ` (username: ${username})` : '';
  console.log(`Admin ready: ${email}${suffix} (user #${rows[0].id}) — they should change this password after signing in.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Failed:', e.message);
    process.exit(1);
  });