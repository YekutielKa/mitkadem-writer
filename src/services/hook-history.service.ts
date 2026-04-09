/**
 * SMART PHASE PREMIUM 01 — Module D
 * Hook history service for anti-repetition.
 *
 * Responsibilities:
 *   1. Extract first-line hook from a published post caption
 *   2. Classify hook technique (regex-based, no LLM)
 *   3. Extract topic keywords (simple noun extraction)
 *   4. Record hook in public.tenant_hook_history (idempotent)
 *   5. Retrieve recent hooks for anti-repetition during generation
 *   6. Backfill hook history from public.content_posts (cron-callable)
 *
 * Design notes:
 *   - Pure functions where possible for testability
 *   - All DB ops via $executeRawUnsafe / $queryRawUnsafe (cross-schema)
 *   - Cleanup keeps last 50 hooks per tenant — older are deleted
 *   - INSERT uses ON CONFLICT (content_post_id) DO NOTHING for idempotency
 */
import type { PrismaClient } from '@prisma/client';
import { getPrisma } from '../lib/prisma';
import { logger } from '../lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Pure extractors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the hook (first meaningful sentence or line) from a caption.
 * Falls back to first 125 chars if no sentence boundary found.
 */
export function extractHook(caption: string): string {
  if (!caption) return '';
  const trimmed = caption.trim();
  // Try first sentence (ending in . ! ? followed by space or newline)
  const sentenceMatch = trimmed.match(/^[^\n]*?[.!?](?=\s|$)/);
  if (sentenceMatch && sentenceMatch[0].length >= 20) {
    return sentenceMatch[0].trim();
  }
  // Try first line
  const firstLine = trimmed.split('\n')[0];
  if (firstLine.length >= 20) {
    return firstLine.trim();
  }
  // Fallback: first 125 chars (Instagram pre-cut limit)
  return trimmed.slice(0, 125).trim();
}

/**
 * Get the first non-emoji, non-punctuation word for first-word repetition checks.
 */
export function extractFirstWord(hook: string): string {
  // Strip leading emoji/punctuation/whitespace
  const cleaned = hook.replace(/^[\s«"„'\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+/u, '');
  const match = cleaned.match(/^[\wА-Яа-яЁё]+/u);
  return match ? match[0].toLowerCase() : '';
}

/**
 * Classify hook technique via regex patterns. No LLM call.
 * Returns one of: question | quote | specific_number | story | pattern_interrupt |
 *                 contradiction | provocation | sensory | statement
 */
export function classifyHookTechnique(hook: string): string {
  const h = hook.trim();
  // Quote — starts with « or "
  if (/^[«"„]/.test(h)) return 'quote';
  // Question — first sentence ends with ?
  if (/^[^.!?\n]*\?/.test(h)) return 'question';
  // Specific number opener — starts with digits
  if (/^\d/.test(h)) return 'specific_number';
  // Story — Когда / Однажды / Вчера / It started / Last week
  if (/^(когда|однажды|вчера|на прошлой|месяц назад|it started|last week)/i.test(h)) return 'story';
  // Pattern interrupt — Знаете / Представьте / Что если / А что если
  if (/^(знаете|представьте|что если|а что если|did you know|imagine)/i.test(h)) return 'pattern_interrupt';
  // Contradiction — Не / Хватит / Stop / Forget
  if (/^(не |хватит |забудь|stop |forget )/i.test(h)) return 'contradiction';
  // Provocation — explicit imperative challenge
  if (/^(перестань|прекрати)/i.test(h)) return 'provocation';
  // Sensory — opens with feeling/perception verb
  if (/^(почувств|представь|услыш|увид)/i.test(h)) return 'sensory';
  return 'statement';
}

/**
 * Extract a small set of topic keywords (3-7 nouns) from a hook for
 * topic-similarity anti-repetition. Lightweight stoplist + length filter.
 */
const STOPWORDS = new Set([
  'это', 'как', 'что', 'для', 'или', 'без', 'над', 'под', 'при', 'про',
  'был', 'была', 'было', 'были', 'есть', 'нет', 'все', 'всё', 'весь',
  'мой', 'моя', 'мои', 'твой', 'ваш', 'наш', 'свой',
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'have', 'has',
]);

export function extractTopicKeywords(hook: string): string[] {
  const words = hook
    .toLowerCase()
    .replace(/[^\wа-яё\s]/giu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  // Dedupe, keep order, take first 7
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
      if (out.length >= 7) break;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB layer
// ─────────────────────────────────────────────────────────────────────────────

const KEEP_LAST_N = 50;

export interface HookHistoryRow {
  id: string;
  tenantId: string;
  contentPostId: string | null;
  hookText: string;
  hookFirstWord: string;
  hookTechnique: string | null;
  hookTopicKeywords: string[] | null;
  createdAt: Date;
}

/**
 * Record a hook for a tenant. Idempotent on content_post_id.
 * After insert, prunes older rows beyond KEEP_LAST_N for this tenant.
 */
export async function recordHook(
  prisma: PrismaClient,
  params: {
    tenantId: string;
    contentPostId: string | null;
    caption: string;
    createdAt?: Date;
  },
): Promise<{ inserted: boolean; hook: string }> {
  const hook = extractHook(params.caption);
  if (!hook || hook.length < 10) {
    return { inserted: false, hook };
  }
  const firstWord = extractFirstWord(hook);
  const technique = classifyHookTechnique(hook);
  const keywords = extractTopicKeywords(hook);
  const createdAt = params.createdAt ?? new Date();

  try {
    const result = await prisma.$executeRawUnsafe(
      `
      INSERT INTO public.tenant_hook_history
        (tenant_id, content_post_id, hook_text, hook_first_word, hook_technique, hook_topic_keywords, created_at)
      VALUES ($1, $2::uuid, $3, $4, $5, $6::text[], $7::timestamp)
      ON CONFLICT (content_post_id) DO NOTHING
      `,
      params.tenantId,
      params.contentPostId,
      hook,
      firstWord,
      technique,
      keywords,
      createdAt,
    );
    if (result === 0) {
      // Already existed — idempotent skip
      return { inserted: false, hook };
    }
    // Cleanup: keep only last N for this tenant
    await prisma.$executeRawUnsafe(
      `
      DELETE FROM public.tenant_hook_history
       WHERE tenant_id = $1
         AND id NOT IN (
           SELECT id FROM public.tenant_hook_history
            WHERE tenant_id = $1
            ORDER BY created_at DESC
            LIMIT ${KEEP_LAST_N}
         )
      `,
      params.tenantId,
    );
    return { inserted: true, hook };
  } catch (e: any) {
    logger.warn(
      { tenantId: params.tenantId, contentPostId: params.contentPostId, error: e?.message },
      '[hook-history] recordHook failed (non-blocking)',
    );
    return { inserted: false, hook };
  }
}

/**
 * Retrieve last N hooks for a tenant. Used by Module A (brief enrichment)
 * for anti-repetition prompt injection.
 */
export async function getRecentHooks(
  prisma: PrismaClient,
  tenantId: string,
  limit = 10,
): Promise<HookHistoryRow[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id, tenant_id AS "tenantId", content_post_id::text AS "contentPostId",
             hook_text AS "hookText", hook_first_word AS "hookFirstWord",
             hook_technique AS "hookTechnique", hook_topic_keywords AS "hookTopicKeywords",
             created_at AS "createdAt"
      FROM public.tenant_hook_history
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      tenantId,
      limit,
    );
    return rows;
  } catch (e: any) {
    logger.warn({ tenantId, error: e?.message }, '[hook-history] getRecentHooks failed');
    return [];
  }
}

/**
 * Idempotent backfill from public.content_posts.
 * For every published post that does not yet have a hook_history row, extract
 * and record. Safe to run repeatedly. Designed to be called from a cron tick.
 *
 * Returns counts so the caller can log progress.
 */
export async function backfillHookHistory(
  prisma: PrismaClient,
  options: { batchSize?: number } = {},
): Promise<{ scanned: number; inserted: number; skipped: number; failed: number }> {
  const batchSize = options.batchSize ?? 50;
  const stats = { scanned: 0, inserted: 0, skipped: 0, failed: 0 };
  try {
    const candidates = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT cp.id::text AS "contentPostId",
             cp.tenant_id AS "tenantId",
             cp.caption,
             cp.published_at AS "publishedAt"
      FROM public.content_posts cp
      LEFT JOIN public.tenant_hook_history h
             ON h.content_post_id = cp.id
      WHERE cp.published_at IS NOT NULL
        AND cp.caption IS NOT NULL
        AND h.id IS NULL
      ORDER BY cp.published_at DESC
      LIMIT $1
      `,
      batchSize,
    );
    stats.scanned = candidates.length;

    for (const row of candidates) {
      const result = await recordHook(prisma, {
        tenantId: row.tenantId,
        contentPostId: row.contentPostId,
        caption: row.caption,
        createdAt: row.publishedAt,
      });
      if (result.inserted) stats.inserted += 1;
      else stats.skipped += 1;
    }
  } catch (e: any) {
    stats.failed += 1;
    logger.error({ error: e?.message }, '[hook-history] backfill failed');
  }
  return stats;
}

/**
 * Convenience wrapper that uses the singleton Prisma instance.
 * Used by the cron tick.
 */
export async function backfillHookHistoryTick(): Promise<void> {
  const db = getPrisma();
  const stats = await backfillHookHistory(db);
  if (stats.scanned > 0) {
    logger.info(stats, '[hook-history] backfill tick complete');
  }
}
