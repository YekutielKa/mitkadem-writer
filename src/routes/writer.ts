import { getPrisma } from '../lib/prisma';
import { Router, Request, Response } from 'express';
import { logger } from '../lib/logger';
import { authMiddleware } from '../middleware/auth';
import { FeedbackSchema } from '../types/writer';
import { getHints, sendFeedback } from '../services/insights.service';

const router = Router();

// POST /v1/writer/feedback - Submit feedback on generated content
router.post('/feedback', authMiddleware, async (req: Request, res: Response) => {
  const input = FeedbackSchema.parse(req.body);

  logger.info(
    { tenantId: input.tenantId, contentId: input.contentId, type: input.feedbackType },
    'Received feedback'
  );

  try {
    const insightsResponse = await sendFeedback(input);

    res.json({
      ok: true,
      feedbackType: input.feedbackType,
      insightsResponse,
    });
  } catch (e: any) {
    logger.error({ error: e.message }, 'Error sending feedback');
    res.status(500).json({ error: 'feedback_failed', message: e.message });
  }
});

// GET /v1/writer/hints - Get personalized hints for content generation
router.get('/hints', authMiddleware, async (req: Request, res: Response) => {
  const tenantId = req.query.tenantId as string;

  if (!tenantId) {
    res.status(400).json({ error: 'tenantId required' });
    return;
  }

  try {
    const hints = await getHints(tenantId);
    res.json({ hints });
  } catch (e: any) {
    logger.error({ error: e.message }, 'Error fetching hints');
    res.status(500).json({ error: 'hints_failed', message: e.message });
  }
});

export default router;


// POST /v1/writer/approve/:taskId — Approve generated content [H-7]
router.post('/approve/:taskId', authMiddleware, async (req: Request, res: Response) => {
  const db = getPrisma();
  const task = await db.writeTask.findUnique({ where: { id: req.params.taskId } });
  
  if (!task) {
    res.status(404).json({ error: 'task_not_found' });
    return;
  }
  if (task.status !== 'pending_approval') {
    res.status(400).json({ error: 'invalid_status', message: `Task status is '${task.status}', expected 'pending_approval'` });
    return;
  }

  const updated = await db.writeTask.update({
    where: { id: task.id },
    data: { status: 'approved' },
  });

  // Send positive feedback to insights
  sendFeedback({ tenantId: task.tenantId, contentId: task.id, feedbackType: 'approved' }).catch(() => {});

  res.json(updated);
});

// POST /v1/writer/reject/:taskId — Reject and optionally regenerate [H-7]
router.post('/reject/:taskId', authMiddleware, async (req: Request, res: Response) => {
  const db = getPrisma();
  const { reason, regenerate } = req.body || {};
  const task = await db.writeTask.findUnique({ where: { id: req.params.taskId } });

  if (!task) {
    res.status(404).json({ error: 'task_not_found' });
    return;
  }
  if (task.status !== 'pending_approval') {
    res.status(400).json({ error: 'invalid_status', message: `Task status is '${task.status}', expected 'pending_approval'` });
    return;
  }

  const updated = await db.writeTask.update({
    where: { id: task.id },
    data: { status: regenerate ? 'queued' : 'rejected' },
  });

  // Send rejection feedback to insights
  sendFeedback({
    tenantId: task.tenantId,
    contentId: task.id,
    feedbackType: 'rejected',
    rejectionReason: reason || undefined,
  }).catch(() => {});

  res.json({ ...updated, willRegenerate: !!regenerate });
});

