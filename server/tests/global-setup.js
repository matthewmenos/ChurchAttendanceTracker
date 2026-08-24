const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');
const { runMigrations } = require('../scripts/migrate');

/** Creates the test database if missing, then applies migrations. */
module.exports = async () => {
  const url = process.env.DATABASE_URL_TEST || 'postgresql://postgres:postgres@127.0.0.1:5432/church_attendance_test';
  const dbName = url.split('/').pop().split('?')[0];
  const adminUrl = url.replace(/\/[^/]+(\?.*)?$/, '/postgres$1');

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await client.end();
  }
  await runMigrations(url);
};