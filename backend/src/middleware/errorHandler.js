import { logger } from '../utils/logger.js';

// Thrown by controllers/services for expected, client-facing failures.
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
}

// Express recognizes 4-arg signature as the error handler — keep `next`.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Postgres unique-violation -> 409 Conflict.
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Resource already exists', detail: err.detail });
  }
  // Postgres invalid-text-representation (e.g. bad UUID) -> 400.
  if (err.code === '22P02') {
    return res.status(400).json({ error: 'Invalid input syntax', detail: err.message });
  }

  const status = err.status || 500;
  if (status >= 500) {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
  } else {
    logger.warn('Request error', { status, error: err.message });
  }

  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(err.details ? { details: err.details } : {}),
  });
}
