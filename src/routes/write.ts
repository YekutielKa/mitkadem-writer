import { Router, Request, Response } from 'express';
import { getPrisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { authMiddleware } from '../middleware/auth';
import { BriefSchema, RunSchema } from '../types/writer';
import { generateContent } from '../services/llm.service';
import { getHints } from '../services/insights.service';
import { logEvent } from '../services/events.service';
import { addToQueue } from '../services/queue.service';

const router = Router();

// POST /v1/write/brief - Создать задачу на генерацию
router.post('/brief', authMiddleware, async (req: Request, res: Response) => {
  const input = BriefSchema.parse(req.body);
  const db = getPrisma();

  const task = await db.writeTask.create({
    data: {
      tenantId: input.tenantId,
      brief: input.brief,
      tone: input.tone,
      audience: input.audience,
      status: 'queued',
    },
  });

  // premium-01/task4d: persist arm fields via raw SQL (Prisma model not regenerated)
  if (input.styleArm || input.topicArm || input.constraintsOverride) {
    try {
      await db.$executeRawUnsafe(
        `UPDATE "WriteTask"
            SET "styleArm" = $1,
                "topicArm" = $2,
                "constraints" = $3::jsonb
          WHERE id = $4`,
        input.styleArm ?? null,
        input.topicArm ?? null,
        input.constraintsOverride ? JSON.stringify(input.constraintsOverride) : null,
        task.id,
      );
    } catch (e: any) {
      logger.warn({ taskId: task.id, error: e?.message }, '[task4d] failed to persist arm fields (non-blocking)');
    }
  }

  // Try to add to queue
  const jobId = await addToQueue(task.id, task.tenantId);

  if (jobId) {
    res.status(202).json({ ...task, async: true, jobId });
  } else {
    res.status(201).json(task);
  }
});

// POST /v1/write/run - Worker вызывает для выполнения
router.post('/run', authMiddleware, async (req: Request, res: Response) => {
  const { taskId } = RunSchema.parse(req.body);
  const db = getPrisma();

  const task = await db.writeTask.findUnique({ where: { id: taskId } });
  if (!task) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  // premium-01/task4d: read arm fields via raw SQL (Prisma model not regenerated)
  let styleArm: string | null = null;
  let topicArm: string | null = null;
  try {
    const rows = await db.$queryRawUnsafe<Array<{ styleArm: string | null; topicArm: string | null }>>(
      `SELECT "styleArm", "topicArm" FROM "WriteTask" WHERE id = $1`,
      taskId,
    );
    if (rows[0]) {
      styleArm = rows[0].styleArm;
      topicArm = rows[0].topicArm;
    }
  } catch (e: any) {
    logger.warn({ taskId, error: e?.message }, '[task4d] failed to read arm fields (non-blocking)');
  }

  // Get hints from insights
  let hints: Record<string, unknown> = {};
  try {
    hints = await getHints(task.tenantId);
    if (Object.keys(hints).length > 0) {
      logger.info({ tenantId: task.tenantId, hints }, 'Got hints from insights');
    }
  } catch (e) {
    logger.warn({ error: e }, 'Failed to get hints');
  }

  // Log start event
  logEvent({
    tenantId: task.tenantId,
    workflowId: null,
    eventType: 'agent.writer.run.start',
    source: 'writer',
    value: 1,
    meta: {
      taskId: task.id,
      brief: task.brief,
      tone: task.tone,
      audience: task.audience,
      hasHints: Object.keys(hints).length > 0,
    },
  }).catch(() => {});

  // Generate content via LLM
  let result: { content: string; hashtags: string[]; image_prompt: string };
  try {
    result = await generateContent({
      tenantId: task.tenantId,
      brief: task.brief,
      tone: (hints.tone as string) || task.tone || undefined,
      audience: task.audience || undefined,
      // premium-01/task4d: arm-aware generation
      styleArm: styleArm || undefined,
      topicArm: topicArm || undefined,
    });
  } catch (err: any) {
    logger.error({ err, taskId }, 'LLM generation failed');
    res.status(500).json({ error: 'llm_generation_failed', details: err?.message });
    return;
  }

  // Update task
  const updated = await db.writeTask.update({
    where: { id: task.id },
    data: { status: 'pending_approval', content: result.content },
  });

  // Log completion event
  logEvent({
    tenantId: updated.tenantId,
    workflowId: null,
    eventType: 'agent.writer.run.pending_approval',
    source: 'writer',
    value: 1,
    meta: {
      taskId: updated.id,
      contentLen: updated.content ? updated.content.length : 0,
    },
  }).catch(() => {});

  res.json({
    ...updated,
    image_prompt: result.image_prompt,
    hashtags: result.hashtags,
  });
});

// GET /v1/write/:id - Получить результат
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  const db = getPrisma();
  const task = await db.writeTask.findUnique({ where: { id: req.params.id } });

  if (!task) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  res.json(task);
});

export default router;
