import express, { Request, Response, NextFunction } from 'express';
import 'express-async-errors';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { exec } from 'child_process';

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

const PORT = parseInt(process.env.PORT || '8080', 10);
const SERVICE_NAME = process.env.SERVICE_NAME || 'mitkadem-writer';
const SERVICE_JWT_SECRET = process.env.SERVICE_JWT_SECRET || 'dev-service-123';
const DEV_ADMIN_SECRET = process.env.DEV_ADMIN_SECRET || '7e3b1a9c5d2f';

const db = new PrismaClient();

// --- health/ready ---
app.get('/healthz', (_req: Request, res: Response) => res.json({ ok: true, early: true }));
app.get('/readyz', async (_req: Request, res: Response) => {
  try { await db.$queryRaw`SELECT 1`; res.json({ ready: true }); }
  catch (e: any) { res.status(500).json({ ready: false, error: e?.message }); }
});

// --- temp migrate (удалим после смоука) ---
app.post('/v1/_dev/migrate', (_req: Request, res: Response) => {
  exec('npx prisma db push --accept-data-loss', (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || String(err) });
    res.json({ ok: true, log: stdout });
  });
});

// --- dev mint ---
app.post('/v1/_dev/mint', (req: Request, res: Response) => {
  const dev = String(req.headers['x-dev-secret'] || '');
  if (dev !== DEV_ADMIN_SECRET) return res.status(401).json({ title: 'bad dev secret' });
  const sub = (req.body?.name as string) ?? 'svc:cli';
  const token = jwt.sign({ sub, aud: 'internal', iss: SERVICE_NAME }, SERVICE_JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// --- auth ---
function auth(req: Request, res: Response, next: NextFunction) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  try { jwt.verify(token, SERVICE_JWT_SECRET); return next(); }
  catch { return res.status(401).send({ error: 'unauthorized' }); }
}

// --- routes ---
const Brief = z.object({
  tenantId: z.string().uuid(),
  brief:    z.string().min(5),
  tone:     z.string().optional(),
  audience: z.string().optional()
});

app.post('/v1/write/brief', auth, async (req: Request, res: Response) => {
  const p = Brief.parse(req.body);
  const task = await db.writeTask.create({
    data: { tenantId: p.tenantId, brief: p.brief, tone: p.tone, audience: p.audience, status: 'queued' }
  });
  res.status(201).json(task);
});

const Run = z.object({ taskId: z.string().uuid() });

app.post('/v1/write/run', auth, async (req: Request, res: Response) => {
  const { taskId } = Run.parse(req.body);
  const task = await db.writeTask.findUnique({ where: { id: taskId } });
  if (!task) return res.status(404).json({ error: 'not found' });

  const content =
`🎯 *${task.brief}*
${task.tone ? `Tone: ${task.tone}` : ''} ${task.audience ? `| Audience: ${task.audience}` : ''}

1) Hook: Grab attention with a bold opener.
2) Value: Explain the benefit of "${task.brief}" for your audience.
3) CTA: Invite readers to act.

#marketing #content #${(task.tone || 'brand').replace(/\s+/g,'')}`;

  const updated = await db.writeTask.update({ where: { id: task.id }, data: { status: 'done', content } });
  res.json(updated);
});

app.get('/v1/write/:id', auth, async (req: Request, res: Response) => {
  const t = await db.writeTask.findUnique({ where: { id: req.params.id } });
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
});

// guards
process.on('unhandledRejection', (e) => logger.error({ err: e }, 'unhandledRejection'));
process.on('uncaughtException', (e) => { logger.error({ err: e }, 'uncaughtException'); });

app.listen(PORT, '0.0.0.0', () => logger.info({ port: PORT, service: SERVICE_NAME }, 'service up'));
