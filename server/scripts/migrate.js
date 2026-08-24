const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

/** Runs every pending .sql migration inside its own transaction. */
async function runMigrations(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())'
    );
    const dir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query('SELECT name FROM _migrations');
    const applied = new Set(rows.map((r) => r.name));
    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations(name) VALUES($1)', [file]);
        await client.query('COMMIT');
        ran += 1;
        console.log(`Applied migration: ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${e.message}`);
      }
    }
    if (!ran) console.log('No pending migrations.');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const env = require('../src/config/env');
  const target = process.argv[2] || env.databaseUrl;
  runMigrations(target)
    .then(() => {
      console.log('Migrations complete.');
      process.exit(0);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}

module.exports = { runMigrations };