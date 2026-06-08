import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getPrisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { authMiddleware } from '../middleware/auth';
import { BriefSchema, RunSchema } from '../types/writer';
import { generateContent, WriterLanguageMismatchUnrecoverableError } from '../services/llm.service';
import { getHints } from '../services/insights.service';
import { logEvent } from '../services/events.service';
import { addToQueue } from '../services/queue.service';
import {
  formatBriefQualityContext,
  lookupBriefQualityForCluster,
} from '../services/brief-quality-lookup';
import { getEnv } from '../config/env';

const MITKADEM_SELF_TENANT_UUID = 'e9efe9c9-fca4-4c38-9d68-c551e8bad4ae';

const router = Router();

// POST /v1/write/brief - Создать задачу на генерацию
router.post('/brief', authMiddleware, async (req: Request, res: Response) => {
  let input: z.infer<typeof BriefSchema>;
  try {
    input = BriefSchema.parse(req.body);
  } catch (e: any) {
    // Sprint O Block 2 — translate the language-required Zod issue into a
    // dedicated HTTP 400 so the ads-launch caller can distinguish the
    // refusal at the contract boundary from a generic schema fail.
    if (e instanceof z.ZodError) {
      const langIssue = e.issues.find((iss) => iss.message === 'language_required');
      if (langIssue) {
        res.status(400).json({
          error: 'language_required',
          message:
            'purpose=ads_creative requires explicit language field (ISO 639-1). Sprint O Block 1 contract.',
        });
        return;
      }
      res.status(400).json({ error: 'invalid_request', details: e.issues });
      return;
    }
    throw e;
  }
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
  // pw3/fix3: store language alongside arm columns
  // b2/t02: also persist platform so /run can use it when creating content_posts
  // Sprint O Block 2 — also persist purpose so /run can engage the
  // script-coherence retry. Column was added 2026-05-21 via plain
  // ALTER TABLE; Prisma model not regenerated yet so raw SQL.
  if (
    input.styleArm ||
    input.topicArm ||
    input.constraintsOverride ||
    input.language ||
    input.platform ||
    input.purpose
  ) {
    try {
      await db.$executeRawUnsafe(
        `UPDATE "WriteTask"
            SET "styleArm" = $1,
                "topicArm" = $2,
                "constraints" = $3::jsonb,
                "language" = $4,
                "platform" = $5,
                "purpose" = $6
          WHERE id = $7`,
        input.styleArm ?? null,
        input.topicArm ?? null,
        input.constraintsOverride ? JSON.stringify(input.constraintsOverride) : null,
        input.language ?? null,
        input.platform ?? null,
        input.purpose ?? null,
        task.id,
      );
    } catch (e: any) {
      logger.warn({ taskId: task.id, error: e?.message }, '[task4d/b2] failed to persist arm fields (non-blocking)');
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
  const { taskId, skipContentPostInsert, contentPostId: ownedContentPostId } = RunSchema.parse(req.body);
  const db = getPrisma();

  const task = await db.writeTask.findUnique({ where: { id: taskId } });
  if (!task) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  // premium-01/task4d: read arm fields via raw SQL (Prisma model not regenerated)
  // Sprint O Block 2 — also read `purpose` to drive the script-coherence retry.
  let styleArm: string | null = null;
  let topicArm: string | null = null;
  let taskLanguage: string | null = null;
  let taskPlatform: string | null = null;
  let taskPurpose: string | null = null;
  try {
    const rows = await db.$queryRawUnsafe<Array<{ styleArm: string | null; topicArm: string | null; language: string | null; platform: string | null; purpose: string | null }>>(
      `SELECT "styleArm", "topicArm", "language", "platform", "purpose" FROM "WriteTask" WHERE id = $1`,
      taskId,
    );
    if (rows[0]) {
      styleArm = rows[0].styleArm;
      topicArm = rows[0].topicArm;
    }
  if (rows[0] && (rows[0] as any).language) {
    taskLanguage = (rows[0] as any).language;
  }
  if (rows[0] && (rows[0] as any).platform) {
    taskPlatform = (rows[0] as any).platform;
  }
  if (rows[0] && (rows[0] as any).purpose) {
    taskPurpose = (rows[0] as any).purpose;
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

  // BLOCK_30 Sprint 7 — Loop 1 writer-side consumer wire. Best-effort lookup
  // brief-quality cluster context from public.learning_events (Path B; Phase 0
  // #15 confirmed writer DB role can SELECT). Layer 1 Mitkadem guard inherited.
  // Default OFF behind BRIEF_QUALITY_LOOKUP_ENABLED. Graceful skip on null.
  let briefAugmentation = '';
  try {
    const env = getEnv();
    if (env.BRIEF_QUALITY_LOOKUP_ENABLED && task.tenantId !== MITKADEM_SELF_TENANT_UUID) {
      const contentArm = styleArm || topicArm || null;
      const cluster = await lookupBriefQualityForCluster(db, {
        tenantId: task.tenantId,
        contentArm,
        targetLanguage: taskLanguage,
        platform: taskPlatform,
      });
      briefAugmentation = formatBriefQualityContext(cluster, env.BRIEF_QUALITY_MIN_CLUSTER_SAMPLE);
      if (briefAugmentation) {
        logger.info(
          { tenantId: task.tenantId, taskId, clusterKey: cluster?.clusterKey, count: cluster?.count },
          '[brief-quality-lookup] augmenting prompt with cluster context',
        );
      }
    }
  } catch (e: any) {
    logger.warn({ taskId, error: e?.message }, '[brief-quality-lookup] non-blocking failure');
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
  let result: { content: string; hashtags: string[]; image_prompt: string; needsReview?: boolean; needsReviewReason?: string };
  try {
    const augmentedBrief = briefAugmentation
      ? `${task.brief}\n\n[brief-quality context] ${briefAugmentation}`
      : task.brief;
    result = await generateContent({
      tenantId: task.tenantId,
      brief: augmentedBrief,
      tone: (hints.tone as string) || task.tone || undefined,
      audience: task.audience || undefined,
      // premium-01/task4d: arm-aware generation
      styleArm: styleArm || undefined,
      topicArm: topicArm || undefined,
      language: taskLanguage || undefined, // pw3/fix3
      // Sprint O Block 2 — drives post-generation script-coherence retry.
      purpose: taskPurpose || undefined,
    });
  } catch (err: any) {
    // Sprint O Block 2 — refuse-don't-guess at the writer boundary.
    if (err instanceof WriterLanguageMismatchUnrecoverableError) {
      logger.error(
        { taskId, attempts: err.attempts, expectedLang: err.expectedLang, expectedScript: err.expectedScript, detected: err.detected },
        '[sprint-o] writer_language_mismatch_unrecoverable — returning 422',
      );
      // Mark the task itself so the orchestrator's storage view shows it
      // didn't silently succeed.
      try {
        await db.writeTask.update({
          where: { id: task.id },
          data: { status: 'language_mismatch_unrecoverable' },
        });
      } catch (e: any) {
        logger.warn({ taskId, error: e?.message }, '[sprint-o] failed to mark WriteTask status (non-fatal)');
      }
      res.status(422).json({
        error: 'writer_language_mismatch_unrecoverable',
        message: err.message,
        attempts: err.attempts,
        expectedLang: err.expectedLang,
        expectedScript: err.expectedScript,
        detected: {
          script: err.detected.script,
          confidence: err.detected.confidence,
          counts: err.detected.counts,
        },
      });
      return;
    }
    logger.error({ err, taskId }, 'LLM generation failed');
    res.status(500).json({ error: 'llm_generation_failed', details: err?.message });
    return;
  }

  // b3/t09: if anti-slop or arm validation failed after all retries, the writer
  // flags `needsReview`. The task goes to `needs_review` — operator must
  // review before anything downstream publishes it.
  const finalStatus = result.needsReview ? 'needs_review' : 'pending_approval';
  if (result.needsReview) {
    logger.warn(
      { taskId: task.id, reason: result.needsReviewReason },
      '[b4] writer flagged content needs_review — blocking auto-publish',
    );
  }

  const updated = await db.writeTask.update({
    where: { id: task.id },
    data: { status: finalStatus, content: result.content },
  });

  // b2/t02: Persist draft into public.content_posts so pipeline has an anchor
  // row that scorer + publisher can update. Non-blocking.
  // Sprint FIX_CONTENT_CADENCE (A1): when the caller already owns the row
  // (skipContentPostInsert — orchestrator under CONTENT_CADENCE_V2_ENABLED),
  // skip this INSERT entirely. This was the orphan-leak source (one orphan row
  // per /run, source NULL, never re-addressed). We echo the caller's owned id.
  let contentPostId: string | null = ownedContentPostId ?? null;
  if (skipContentPostInsert) {
    logger.info(
      { taskId: task.id, ownedContentPostId: contentPostId },
      '[cadence-v2/A1] skipContentPostInsert — orchestrator owns the content_posts row; writer skips anchor INSERT',
    );
  } else
  try {
    const platformFromTask = taskPlatform || ((task as unknown as { platform?: string }).platform) || 'instagram';
    const contentArm = styleArm || topicArm || null;
    const imagePrompt = result.image_prompt || null;
    // b3/t09: if writer flagged needs_review, persist as 'needs_review' so
    // scorer/publisher never pick it up for auto-scheduling.
    const contentPostStatus = result.needsReview ? 'needs_review' : 'draft';
    const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO public.content_posts
         (tenant_id, platform, content_arm, caption, status, image_prompt, image_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::text IS NULL THEN 'skipped' ELSE 'pending' END, NOW(), NOW())
       RETURNING id::text AS id`,
      task.tenantId,
      platformFromTask,
      contentArm,
      result.content,
      contentPostStatus,
      imagePrompt,
    );
    contentPostId = rows[0]?.id ?? null;
    if (contentPostId) {
      // Link WriteTask → content_posts for traceability. SF6 (FOUNDATION_FIX
      // Sprint 2.6): cast $1 to uuid — column is uuid, raw param is text;
      // implicit cast in prepared statements fails silently. Surface failure
      // via logger.warn so future regressions don't stay invisible.
      await db.$executeRawUnsafe(
        `UPDATE "WriteTask" SET "contentPostId" = $1::uuid WHERE id = $2`,
        contentPostId,
        task.id,
      ).catch((e: any) => {
        logger.warn(
          { taskId: task.id, contentPostId, error: e?.message },
          '[b2/t02] WriteTask.contentPostId update failed (non-blocking)',
        );
      });
    }
  } catch (e: any) {
    logger.warn({ taskId: task.id, error: e?.message }, '[b2/t02] content_posts insert failed (non-blocking)');
  }

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
      contentPostId,
    },
  }).catch(() => {});

  res.json({
    ...updated,
    image_prompt: result.image_prompt,
    hashtags: result.hashtags,
    contentPostId,
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
