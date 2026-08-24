/**
 * Creates or resets a single admin account — use this to bootstrap
 * a production database without seeding demo data.
 *
 *   node scripts/create-admin.js "Pastor Kwesi Mensah" "admin@copagonaahanta.app" "StrongPass123"
 *   (or set ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD env vars)
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

  const hash = await hashPassword(password);
  const { rows } = await db.query(
    `INSERT INTO users (name, email, password_hash, role, must_change_password)
     VALUES ($1, $2, $3, 'admin', TRUE)
     ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            role = 'admin',
            status = 'active',
            must_change_password = TRUE
     RETURNING id`,
    [name, email, hash]
  );
  console.log(`Admin ready: ${email} (user #${rows[0].id}) — they should change this password after signing in.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Failed:', e.message);
    process.exit(1);
  });