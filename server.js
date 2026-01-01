"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
require("express-async-errors");
const cors_1 = __importDefault(require("cors"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const pino_1 = __importDefault(require("pino"));
const pino_http_1 = __importDefault(require("pino-http"));
const eventsClient_1 = require("./src/services/eventsClient");
const app = (0, express_1.default)();
const logger = (0, pino_1.default)({ level: process.env.LOG_LEVEL || 'info' });
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '1mb' }));
app.use((0, pino_http_1.default)({ logger }));
const PORT = parseInt(process.env.PORT || '8800', 10) || 8080;
const SERVICE_NAME = process.env.SERVICE_NAME || 'mitkadem-writer';
const SERVICE_JWT_SECRET = process.env.SERVICE_JWT_SECRET || 'dev-service-123';
const DEV_ADMIN_SECRET = process.env.DEV_ADMIN_SECRET || '7e3b1a9c5d2f';
const db = new (class extends client_1.PrismaClient {
})();
// --- health/ready ---
app.get('/healthz', (_req, res) => res.json({ ok: true, early: true }));
app.get('/readyz', async (_req, res) => {
    try {
        await db.$queryRaw `SELECT 1`;
        res.json({ ready: true });
    }
    catch (e) {
        res.status(500).json({ ready: false, error: e?.message });
    }
});
// --- dev mint ---
app.post('/v1/_dev/mint', (req, res) => {
    const dev = String(req.headers['x-dev-secret'] || '');
    if (dev !== DEV_ADMIN_SECRET)
        return res.status(401).json({ error: 'bad dev secret' });
    const sub = req.body?.name ?? 'svc:cli';
    const token = jsonwebtoken_1.default.sign({ sub, aud: 'internal', iss: SERVICE_NAME }, SERVICE_JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
});
// --- auth ---
function auth(req, res, next) {
    const h = String(req.headers.authorization || '');
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    try {
        jsonwebtoken_1.default.verify(token, SERVICE_JWT_SECRET);
        return next();
    }
    catch {
        return res.status(401).json({ error: 'unauthorized' });
    }
}
// --- schemas ---
const Brief = zod_1.z.object({
    tenantId: zod_1.z.string().min(1),
    brief: zod_1.z.string().min(5),
    tone: zod_1.z.string().optional(),
    audience: zod_1.z.string().optional()
});
const Run = zod_1.z.object({ taskId: zod_1.z.string().uuid() });
// --- routes ---
app.post('/v1/write/brief', auth, async (req, res) => {
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
app.post('/v1/write/run', auth, async (req, res) => {
    const { taskId } = Run.parse(req.body);
    const task = await db.writeTask.findUnique({ where: { id: taskId } });
    if (!task)
        return res.status(404).json({ error: 'not found' });
    // логируем старт работы writer'а
    try {
        (0, eventsClient_1.logEvent)({
            tenantId: task.tenantId,
            workflowId: null,
            eventType: 'agent.writer.run.start',
            source: 'writer',
            value: 1,
            meta: {
                taskId: task.id,
                brief: task.brief,
                tone: task.tone,
                audience: task.audience
            }
        }).catch(() => { });
    }
    catch (_) { }
    const content = `🎯 *${task.brief}*
${task.tone ? `Tone: ${task.tone}` : ''}${task.audience ? ` | Audience: ${task.audience}` : ''}

1) Hook — grab attention with a bold opener.
2) Value — explain the benefit of “${task.brief}”.
3) CTA — invite readers to act.

#marketing #content #${(task.tone || 'brand').replace(/\s+/g, '')}`;
    const updated = await db.writeTask.update({
        where: { id: task.id },
        data: { status: 'done', content: content }
    });
    // логируем завершение
    try {
        (0, eventsClient_1.logEvent)({
            tenantId: updated.tenantId,
            workflowId: null,
            eventType: 'agent.writer.run.done',
            source: 'writer',
            value: 1,
            meta: {
                taskId: updated.id,
                contentLen: updated.content ? updated.content.length : 0
            }
        }).catch(() => { });
    }
    catch (_) { }
    res.json(updated);
});
app.get('/v1/write/:id', auth, async (req, res) => {
    const t = await db.writeTask.findUnique({ where: { id: req.params.id } });
    if (!t)
        return res.status(404).json({ error: 'not found' });
    res.json(t);
});
// --- guards ---
app.use((err, _req, res, _next) => {
    logger.error({ err }, 'unhandled_error');
    res
        .status(err?.status || 500)
        .json({ error: err?.message || 'internal error' });
});
process.on('unhandledRejection', (e) => logger.error({ err: e }, 'unhandledRejection'));
process.on('uncaughtException', (e) => logger.error({ err: e }, 'uncaughtException'));
// bind
app.listen(process.env.PORT ? Number(process.env.PORT) : PORT, '0.0.0.0', () => {
    logger.info({ port: process.env.PORT || PORT, service: SERVICE_NAME }, 'service up');
});
