import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import jwt from 'express'

import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import pino from 'pino';
import pinoHttp from 'pino-http';

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

const PORT = parseInt(process.env.PORT || '8080', 10);
const SERVICE_NAME = process.env.SERVICE_NAME || 'mitkadem-writer';
const SERVICE_JWT_SECRET = process.env.SERVICE_JWT_SECRET || 'dev-service-123';
const DEV_ADMIN_SECRET = process.env.DEV_ADMIN_SECRET || '7e3b1a9c5d2f';

let _db: PrismaClient | null = null;
function db(): PrismaClient { return _db ?? (_db = new PrismaClient()); }

// early health
app.get('/healthz', (_req, res) => res.json({ ok: true, early: true }));

// ready
app.get('/readyz', async (_req, res) => {
  try { await db().$queryRaw`SELECT 1`; res.json({ ready: true }); }
  catch (e:any) { res.status(500).json({ ready: false, error: e?.message }); }
});

// dev mint
import jwt from 'jsonwebtoken';
app.post('/v1/_dev/mint', (req, res) => {
  const dev = String(req.headers['x-dev-secret'] || '');
  if (dev !== DEV_ADMIN_SECRET) return res.status(401).json({ error: 'bad dev secret' });
  const sub = (req.body && (req.body as any).name) || 'svc:cli';
  const token = jwt.sign({ sub, aud: 'internal', iss: SERVICE_NAME }, SERVICE_JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// temp migrate (remove after smoke)
import { exec } from 'child_process';
app.post('/v1/_dev/migrate', (_req, res) => {
  exec('npx prisma db push --accept-data-loss', (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || String(err) });
    res.json({ ok: true, log: stdout });
  });
});

// auth
function auth(req: any, res: any, next: any) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  try { jwt.verify(token, SERVICE_JWT_SECRET); return next(); }
  catch { return res.status(401).json({ error: 'unauthorized' }); }
}

// routes
const Brief = z.object({
  tenantId: z.string().uuid(),
  brief: z.string().min(5),
  tone: z.string().optional(),
  audience: z.string().optional()
});

app.post('/v1/write/brief', auth, async (req, res) => {
  const p = Brief.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const task = await db().writeTask.create({
    data: { tenantId: p.data.tenantId, brief: p.data.brief, tone: p.data.tone, audience: p.data.audience, status: 'queued' }
  });
  res.status(201).json(task);
});

const Run = z.object({ taskId: z.string().uuid() });

app.post('/v1/write/run', auth, async (req, res) => {
  const p = Run.safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: p.error.flatten() });
  const task = await db().writeTask.findUnique({ where: { id: p.data.taskId } });
  if (!task) return res.status(404).json({ error: 'task not found' });

  const parts = [
    `🎯 Campaign: ${task.brief}`,
    task.tone ? `Tone: ${task.tone}` : '',
    task.audience ? `Audience: ${task.audience}` : '',
    '',
    `Draft: Unlock ${task.brief} with a fresh ${task.tone || 'engaging'} voice. ` +
    `Here’s a compelling post tailored for ${task.audience || 'your audience'}:`,
    '',
    `✨ ${task.brief} — why it matters`,
    `👉 Key point #1 ...`,
    `👉 Key point #2 ...`,
    `#Marketing #Growth #${(task.tone||'brand').replace(/\s+/g,'')}`
  ].filter(Boolean).join('\n');

  const updated = await db().writeTask.update({
    where: { id: task.id },
    data: { status: 'done', content: parts }
  });
  res.json(updated);
});

app.get('/v1/write/:id', auth, async (req, res) => {
  const t = await db().writeTask.findUnique({ id: undefined, where: { id: req.params.id } as any });
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
});

process.on('unhandledRejection', e => logger.error({ err: e }, 'unhandledRejection'));
process.on('uncaughtException', e => { logger.error({ err: e }, 'uncaughtException'); });

app.listen(PORT, '0.0.0.0', () => logger.info({ port: PORT, service: SERVICE_NAME }, 'service up'));
