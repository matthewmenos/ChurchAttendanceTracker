const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const env = require('./config/env');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/error');

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  const origins = env.corsOrigin === '*'
    ? true
    : env.corsOrigin.split(',').map((o) => o.trim());
  app.use(cors({ origin: origins, credentials: true }));

  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.use('/api', routes);
  app.use('/api', notFoundHandler);

  // Serve the built React app in production.
  const distDir = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      return res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };