// Vercel Serverless Function entry: every /api/* request is handled by the Express app.
const { createApp } = require('../server/src/app');

const app = createApp();

module.exports = app;