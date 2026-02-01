import { Router, Request, Response } from 'express';
import { getPrisma } from '../lib/prisma';
import { getEnv } from '../config/env';

const router = Router();

// Liveness probe
router.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'mitkadem-writer' });
});

// Readiness probe
router.get('/readyz', async (_req: Request, res: Response) => {
  try {
    const db = getPrisma();
    await db.$queryRaw`SELECT 1`;
    res.json({ ready: true });
  } catch (e: any) {
    res.status(500).json({ ready: false, error: e?.message });
  }
});

// Diagnostics
router.get('/diag', async (_req: Request, res: Response) => {
  const env = getEnv();
  const db = getPrisma();

  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {}

  res.json({
    service: env.SERVICE_NAME,
    version: '0.2.0',
    node_env: env.NODE_ENV,
    database: dbOk ? 'connected' : 'disconnected',
    redis: env.REDIS_URL ? 'configured' : 'not_configured',
    uptime: process.uptime(),
  });
});

export default router;
