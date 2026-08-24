const { ApiError } = require('../utils/errors');

function notFoundHandler(req, res) {
  res.status(404).json({ message: `Not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      message: err.message,
      ...(err.details ? { errors: err.details } : {}),
    });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON in request body.' });
  }
  if (err && err.code === '23505') {
    return res.status(409).json({ message: 'That value already exists.' });
  }
  console.error('[error]', err.stack || err);
  const status = Number(err.status || err.statusCode || 500);
  if (status >= 400 && status < 500) {
    return res.status(status).json({ message: err.message || 'Request failed.' });
  }
  return res.status(500).json({ message: 'Something went wrong on the server.' });
}

module.exports = { notFoundHandler, errorHandler };