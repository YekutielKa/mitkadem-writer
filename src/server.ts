import express, { Request, Response, NextFunction } from 'express';
import 'express-async-errors';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import pino from 'pino';
import pinoHttp from 'pino-http';

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

const PORT = parseInt(process.env.PORT || '8800', 10) || 8080; // 8080 будет проброшен Railway через ENV
const SERVICE_NAME = process.env.SERVICE_NAME || 'mitkadem-writer';
const SERVICE_JWT_SECRET = process.env.SERVICE_JWT_SECRET || 'dev-service-123';
const DEV_ADMIN_SECRET = process.env.DEV_ADMIN_SECRET || '7e3b1a9c5d2f';

const db = new (class extends PrismaClient {})();

// --- health/ready ---
app.get('/healthz', (_req: Request, res: Response) => res.json({ ok: true, early: true }));
app.get('/readyz', async (_req: Request, res: Response) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ ready: true });
  } catch (e: any) {
    res.status(500).json({ ready: false, error: e?.message });
  }
});

// --- dev mint (оставляем) ---
app.post('/v1/_dev/mint', (req: Request, res: Response) => {
  const dev = String(req.headers['x-dev-secret'] || '');
  if (dev !== DEV_ADMIN_SECRET) return res.status(401).json({ error: 'bad dev secret' });
  const sub = (req.body?.name as string) ?? 'svc:cli';
  const token = jwt.sign({ sub, aud: 'internal', iss: SERVICE_NAME }, SERVICE_JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// --- auth ---
function auth(req: Request, res: Response, next: NextFunction) {
    const h = String(req.headers.authorization || '');
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    try {
      jwt.verify(token, SERVICE_JWT_SECRET);
      return next();
    } catch {
      return res.status(401).json({ error: 'unauthorized' });
    }
}

// --- schemas ---
const Brief = z.object({
  tenantId: z.string().uuid(),
  brief:    z.string().min(5),
  tone:     z.string().optional(),
  audience: z.string().optional()
});

const Run = z.object({ taskId: z.string().uuid() });

// --- routes ---
app.post('/v1/write/brief', auth, async (req: Request, res: Response) => {
  const p = Brief.parse(req.body);
  const task = await db.writeTask.create({
    data: {
      tenantId: p.tenantId,
      brief: p.brief,
      tone: p.tone,
      audience: p.audience,
      status: 'queued'
    }
  });
  res.status(201).json(task);
});

app.post('/v1/write/run', auth, async (req: Request, res: Response) => {
  const { taskId } = Run.parse(req.body);
  const task = await db.writeTask.findUnique({ where: { id: taskId } });
  if (!task) return res.status(404).json({ error: 'not found' });

  const content =
`🎯 *${task.brief}*
${task.tone ? `Tone: ${task.tone}` : ''}${task.audience ? ` | Audience: ${task.audience}` : ''}

1) Hook — grab attention with a bold opener.
2) Value — explain the benefit of “${task.brief}”.
3) CTA — invite readers to act.

#marketing #content #${(task.tone || 'brand').replace(/\s+/g,'')}`;

  const updated = await db.writeTask.update({
    where: { id: task.id },
    data: { status: 'done', content: content }
  });
  res.json(updated);
});

app.get('/v1/write/:id', auth, async (req: Request, res: Response) => {
  const t = await db.writeTask.findByUnique ? null : await db.writeTask.findUnique({ where: { id: req.params.id } });
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
});

// --- guards ---
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'unhandled_error');
  res.status(err?.status || 500).json({ error: err?.message || 'internal error' });
});
process.on('unhandledRejection', (e) => logger.error({ err: e }, 'unhandledRejection'));
process.on('uncaughtException', (e) => logger.error({ err: e }, 'uncaughtException'));

// bind
app.listen(process.env.PORT ? Number(process.env.PORT) : PORT, '0.0.0.0', () => {
  logger.info({ port: process.env.PORT || PORT, service: SERVICE_NAME }, 'service up');
});
