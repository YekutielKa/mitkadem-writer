import { getPrisma } from '../lib/prisma';
import { Router, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { logger } from '../lib/logger';
import { authMiddleware } from '../middleware/auth';
import { FeedbackSchema } from '../types/writer';
import { getHints, sendFeedback } from '../services/insights.service';
import { publishPost } from '../services/adapters-meta-client.service';

const MITKADEM_SELF_TENANT_UUID = 'e9efe9c9-fca4-4c38-9d68-c551e8bad4ae';

// BLOCK_30 Sprint 4 — synthetic brandPageId derived deterministically from
// tenantId. Stub mode only; real-mode requires founder-operational brand-page
// linkage table (deferred к Sprint 5+).
function deriveSyntheticBrandPageId(tenantId: string): string {
  return `synthetic_brand_${createHash('sha256').update(tenantId).digest('hex').slice(0, 12)}`;
}

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
// BLOCK_30 Sprint 4: extended with publish trigger via adapters-meta synthetic publish.
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

  // BLOCK_30 Sprint 4 — Layer 1 defense-in-depth: skip publish for Mitkadem self-tenant.
  if (task.tenantId === MITKADEM_SELF_TENANT_UUID) {
    logger.info({ taskId: task.id }, '[approve.publish] skipped (mitkadem self-tenant)');
    res.json({ ...updated, publishSkipped: true, publishSkipReason: 'mitkadem_self_tenant' });
    return;
  }

  // Resolve content_posts row associated with this WriteTask (set by /v1/write/run).
  const taskWithPost = task as unknown as { contentPostId?: string | null; platform?: string | null; language?: string | null };
  const contentPostId = taskWithPost.contentPostId ?? null;
  if (!contentPostId) {
    logger.warn({ taskId: task.id }, '[approve.publish] missing contentPostId — skip publish + return approved');
    res.json({ ...updated, publishSkipped: true, publishSkipReason: 'missing_content_post_id' });
    return;
  }

  const brandPageId = deriveSyntheticBrandPageId(task.tenantId);
  const platform = (taskWithPost.platform === 'facebook' ? 'facebook' : 'instagram') as 'instagram' | 'facebook';
  const language = taskWithPost.language ?? undefined;

  let publishOk = false;
  let externalPostId: string | null = null;
  let publishMode: 'synthetic' | 'real' | null = null;
  let publishedAt: string | null = null;

  try {
    const result = await publishPost({
      tenantId: task.tenantId,
      brandPageId,
      content: task.content ?? '',
      language,
      platform,
    });
    externalPostId = result.externalPostId;
    publishMode = result.mode;
    publishedAt = result.publishedAt;
    publishOk = true;
  } catch (e: any) {
    logger.error({ taskId: task.id, error: e?.message }, '[approve.publish] adapters-meta publish failed');
  }

  // Update content_posts row: reuse existing columns (external_post_id,
  // published_at, status) — no schema augmentation этот sprint per AME-03 carrier
  // (mitkadem_app lacks ALTER privilege on public.content_posts; B5-DBOWNER-ROUTE
  // workaround deferred к Sprint 9-10 founder operational gate).
  try {
    if (publishOk && externalPostId && publishedAt) {
      await db.$executeRawUnsafe(
        `UPDATE public.content_posts
            SET external_post_id = $1,
                published_at = $2::timestamp,
                status = 'published',
                updated_at = NOW()
          WHERE id = $3::uuid`,
        externalPostId,
        publishedAt,
        contentPostId,
      );
    } else {
      await db.$executeRawUnsafe(
        `UPDATE public.content_posts
            SET status = 'publish_failed',
                updated_at = NOW()
          WHERE id = $1::uuid`,
        contentPostId,
      );
    }
  } catch (e: any) {
    logger.warn({ taskId: task.id, contentPostId, error: e?.message }, '[approve.publish] content_posts update failed (non-blocking)');
  }

  // Emit agent.writer.published learning_event (chain A producer surface for
  // Sprint 6+ engagement-signal collector). publish_mode carried in input_data
  // since content_posts schema augmentation deferred (AME-03).
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO public.learning_events (id, tenant_id, source, event_type, input_data, output_data, outcome, severity, created_at)
       VALUES (gen_random_uuid()::text, $1, 'writer', $2, $3::jsonb, $4::jsonb, $5, $6, NOW())`,
      task.tenantId,
      publishOk ? 'agent.writer.published' : 'agent.writer.publish_failed',
      JSON.stringify({ taskId: task.id, contentPostId, brandPageId, platform, publishMode }),
      JSON.stringify({ externalPostId, publishedAt }),
      publishOk ? 'positive' : 'negative',
      publishOk ? 'info' : 'error',
    );
  } catch (e: any) {
    logger.warn({ taskId: task.id, error: e?.message }, '[approve.publish] learning_events emit failed (non-blocking)');
  }

  res.json({
    ...updated,
    publishOk,
    externalPostId,
    publishMode,
    publishedAt,
  });
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

