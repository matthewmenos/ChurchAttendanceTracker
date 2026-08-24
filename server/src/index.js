const env = require('./config/env');
const { createApp } = require('./app');
const db = require('./config/db');

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`Church Attendance Tracker API listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down...`);
  server.close(async () => {
    try {
      await db.end();
    } catch (e) {
      // pool may already be closed
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));