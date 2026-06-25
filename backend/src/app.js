import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { query } from './config/db.js';
import { logger } from './utils/logger.js';
import { asyncHandler } from './utils/asyncHandler.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import merchantRoutes from './routes/merchants.js';
import posDeviceRoutes from './routes/posDevices.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
  app.use(express.json({ limit: '1mb' }));

  // Pipe HTTP access logs through our JSON logger.
  app.use(
    morgan('tiny', {
      stream: { write: (msg) => logger.info(msg.trim()) },
    }),
  );

  // Liveness: process is up.
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Readiness: DB is reachable.
  app.get(
    '/health/ready',
    asyncHandler(async (req, res) => {
      await query('SELECT 1');
      res.json({ status: 'ready', db: 'up' });
    }),
  );

  app.use('/api/merchants', merchantRoutes);
  app.use('/api/pos-devices', posDeviceRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
