// Tiny dependency-free structured logger. Levels are gated by LOG_LEVEL.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const current = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function emit(level, message, meta) {
  if (LEVELS[level] > current) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };
  const sink = level === 'error' || level === 'warn' ? console.error : console.log;
  sink(JSON.stringify(line));
}

export const logger = {
  error: (msg, meta) => emit('error', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  debug: (msg, meta) => emit('debug', msg, meta),
};
