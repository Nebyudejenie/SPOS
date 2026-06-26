import 'dotenv/config';

import { createApp } from './app.js';
import { waitForDatabase, closePool } from './config/db.js';
import { logger } from './utils/logger.js';

const PORT = Number(process.env.PORT) || 4000;

async function main() {
  await waitForDatabase();

  const app = createApp();
  const server = app.listen(PORT, () => {
    logger.info(`SPOS API listening on port ${PORT}`);
  });

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    // Force-exit if connections do not drain in time.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
