const { Pool } = require('pg');
const env = require('./env');

// Managed providers (Neon, Supabase, Render, Railway) require TLS.
// Honour sslmode in the connection string automatically.
const requiresSsl = /sslmode=(require|verify-ca|verify-full)/.test(env.databaseUrl || '');

const pool = new Pool({
  connectionString: env.databaseUrl,
  max: env.isTest ? 5 : 10,
  ...(requiresSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

module.exports = pool;