import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import 'express-async-errors';

import { logger } from './lib/logger';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';

import healthRoutes from './routes/health';
import { getPrisma } from './lib/prisma';
import devRoutes from './routes/dev';
import writeRoutes from './routes/write';
import writerRoutes from './routes/writer';

const app = express();

// Middleware
app.use(cors());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));
app.use(requestIdMiddleware);

// Routes
app.use('/', healthRoutes);
app.use('/v1/_dev', devRoutes);
app.use('/v1/write', writeRoutes);
app.use('/v1/writer', writerRoutes);

// Error handler (must be last)
app.use(errorHandler);


// === premium-01/task4a: writeTask arm columns migration ===
/**
 * Idempotent ALTER for arm-aware writer (Task 4).
 * Runs once on app boot. Safe to re-run, safe under concurrent boots.
 */
export async function migrateWriteTaskArmColumns(): Promise<void> {
  const db = getPrisma();
  try {
    await db.$executeRawUnsafe(`ALTER TABLE "WriteTask" ADD COLUMN IF NOT EXISTS "styleArm"   TEXT`);
    await db.$executeRawUnsafe(`ALTER TABLE "WriteTask" ADD COLUMN IF NOT EXISTS "topicArm"   TEXT`);
    await db.$executeRawUnsafe(`ALTER TABLE "WriteTask" ADD COLUMN IF NOT EXISTS "constraints" JSONB`);
    logger.info('[startup-migration] WriteTask arm columns ready');
  } catch (e: any) {
    logger.error({ err: e?.message }, '[startup-migration] WriteTask migration failed');
    throw e;
  }
}

// Fire-and-forget on import; failure crashes the process before listen.
migrateWriteTaskArmColumns().catch((e) => {
  logger.fatal({ err: e?.message }, '[startup] arm migration failed — exiting');
  process.exit(1);
});
// === /premium-01/task4a ===

export default app;
