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
import cron from 'node-cron';
import { backfillHookHistoryTick } from './services/hook-history.service';
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


// === premium-01/module-d: hook history table migration ===
/**
 * Idempotent CREATE for premium copywriting hook history.
 * Stores extracted first-line hooks from published posts for anti-repetition.
 */
export async function migrateHookHistoryTable(): Promise<void> {
  const db = getPrisma();
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.tenant_hook_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id text NOT NULL,
        content_post_id uuid UNIQUE,
        hook_text text NOT NULL,
        hook_first_word text NOT NULL,
        hook_technique text,
        hook_topic_keywords text[],
        created_at timestamp DEFAULT NOW()
      )
    `);
    await db.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS tenant_hook_history_tenant_idx
        ON public.tenant_hook_history(tenant_id, created_at DESC)
    `);
    await db.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS tenant_hook_history_content_post_idx
        ON public.tenant_hook_history(content_post_id)
    `);
    logger.info('[startup-migration] tenant_hook_history table ready');
  } catch (e: any) {
    logger.error({ err: e?.message }, '[startup-migration] hook history migration failed');
    throw e;
  }
}

migrateHookHistoryTable().catch((e) => {
  logger.fatal({ err: e?.message }, '[startup] hook history migration failed — exiting');
  process.exit(1);
});
// === /premium-01/module-d ===

// === premium-01/module-d-cron: hook history backfill cron ===
/**
 * Periodically scan content_posts for newly published posts and extract
 * their first-line hooks into tenant_hook_history. Idempotent.
 *
 * Why a cron and not an event listener:
 *   - calendar already emits post_published events to insights, but plugging
 *     writer into that event flow requires cross-service coordination
 *   - Backfill via DB scan is fully isolated, idempotent, and survives writer
 *     restarts and missed events without any reconciliation logic
 *   - First boot also picks up all historical published posts automatically
 */
cron.schedule('*/5 * * * *', () => {
  backfillHookHistoryTick().catch((e) => {
    // Already logged inside the tick — this is the last-resort guard
    void e;
  });
});

// Warm-up: run one backfill ~15s after boot so the app is ready
setTimeout(() => {
  backfillHookHistoryTick().catch(() => {});
}, 15_000);
// === /premium-01/module-d-cron ===


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

    // pw3/fix3: add language column
    await db.$executeRawUnsafe(`
      ALTER TABLE "WriteTask" ADD COLUMN IF NOT EXISTS "language" TEXT
    `);
    logger.info('[startup-migration] WriteTask language column ready');
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
