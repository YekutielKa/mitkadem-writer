/**
 * BLOCK_30 Sprint 7 — Loop 1 writer-side consumer wire (Sprint 6 carrier
 * completion). Path B per Phase 0 #15 evidence (writer DB role superuser ⇒
 * direct SELECT on public.learning_events viable). Preserves corpus #82
 * (writer NOT mb caller; ZERO MARKETING_BRAIN_URL).
 *
 * Queries `public.learning_events` for latest `agent.mb.brief_quality_assessed`
 * cluster row matching (content_arm, target_language, platform). Mb-side Loop
 * 1 service (Sprint 6 brief-quality-assessment.ts) emits one row per cluster
 * per cycle — this lookup retrieves the most-recent for prompt augmentation.
 *
 * Defense-in-depth (Layer 1 inheritance — Sprint 4 publishSkipped pattern):
 *   - Mitkadem self-tenant guard: returns null без query if tenantId matches.
 *   - SQL `WHERE tenant_id != $MITKADEM_UUID` redundant guard.
 *   - Best-effort: try/catch + null return on any failure (never blocks
 *     write-task generation).
 *
 * Default OFF (BRIEF_QUALITY_LOOKUP_ENABLED=false). Caller decides minimum
 * cluster sample size threshold (BRIEF_QUALITY_MIN_CLUSTER_SAMPLE) before
 * injecting context into LLM prompt.
 */

import type { PrismaClient } from '@prisma/client';
import { CircuitBreaker, CircuitBreakerOpenError } from '../lib/circuit-breaker';
import { retryWithBackoff, RetryExhaustedError } from '../lib/retry';
import { logger } from '../lib/logger';
import { getEnv } from '../config/env';

const MITKADEM_SELF_TENANT_UUID = 'e9efe9c9-fca4-4c38-9d68-c551e8bad4ae';

let _breaker: CircuitBreaker | null = null;
function getBreaker(): CircuitBreaker {
  if (_breaker) return _breaker;
  const env = getEnv();
  _breaker = new CircuitBreaker(
    {
      failureThreshold: env.BRIEF_QUALITY_LOOKUP_BREAKER_FAILURE_THRESHOLD,
      cooldownMs: env.BRIEF_QUALITY_LOOKUP_BREAKER_COOLDOWN_SEC * 1000,
    },
    (from, to) => {
      logger.warn(
        { component: 'brief-quality-lookup', from, to },
        'brief-quality-lookup.circuit-breaker state transition',
      );
    },
  );
  return _breaker;
}

export interface BriefQualityCluster {
  clusterKey: string;
  count: number;
  meanRate: number;
  p50: number;
  p80: number;
  postsWithoutSignal: number;
  assessedAt: string | null;
}

interface RawLookupRow {
  cluster_key: string | null;
  count: number | null;
  mean: number | null;
  p50: number | null;
  p80: number | null;
  posts_without_signal: number | null;
  assessed_at: string | null;
}

export async function lookupBriefQualityForCluster(
  prisma: PrismaClient,
  args: {
    tenantId: string;
    contentArm: string | null;
    targetLanguage: string | null;
    platform: string | null;
  },
): Promise<BriefQualityCluster | null> {
  // Layer 1 Mitkadem guard.
  if (args.tenantId === MITKADEM_SELF_TENANT_UUID) return null;

  const arm = args.contentArm ?? 'unknown_arm';
  const lang = args.targetLanguage ?? 'unknown_lang';
  const plat = args.platform ?? 'unknown_platform';
  const clusterKey = `${arm}|${lang}|${plat}`;

  const env = getEnv();
  const breaker = getBreaker();

  try {
    const rows = await breaker.execute(() =>
      retryWithBackoff(
        () =>
          prisma.$queryRawUnsafe<RawLookupRow[]>(
            `SELECT
                (input_data->>'clusterKey') AS cluster_key,
                ((output_data->>'count')::int) AS count,
                ((output_data->>'mean')::float) AS mean,
                ((output_data->>'p50')::float) AS p50,
                ((output_data->>'p80')::float) AS p80,
                ((output_data->>'postsWithoutSignal')::int) AS posts_without_signal,
                (output_data->>'assessedAt') AS assessed_at
               FROM public.learning_events
              WHERE event_type = 'agent.mb.brief_quality_assessed'
                AND tenant_id = $1
                AND tenant_id != $2
                AND (input_data->>'clusterKey') = $3
              ORDER BY created_at DESC
              LIMIT 1`,
            args.tenantId,
            MITKADEM_SELF_TENANT_UUID,
            clusterKey,
          ),
        {
          maxAttempts: env.BRIEF_QUALITY_LOOKUP_RETRY_MAX_ATTEMPTS,
          baseMs: env.BRIEF_QUALITY_LOOKUP_RETRY_BASE_MS,
          maxMs: env.BRIEF_QUALITY_LOOKUP_RETRY_MAX_MS,
        },
        (attempt, err) => {
          logger.warn(
            {
              component: 'brief-quality-lookup',
              tenantId: args.tenantId,
              clusterKey,
              attempt,
              lastErrorMessage: (err as { message?: string } | null)?.message,
            },
            'brief-quality-lookup.lookupBriefQualityForCluster retry attempt',
          );
        },
      ),
    );
    if (!rows[0] || !rows[0].cluster_key) return null;
    const r = rows[0];
    return {
      clusterKey: r.cluster_key as string,
      count: r.count ?? 0,
      meanRate: r.mean ?? 0,
      p50: r.p50 ?? 0,
      p80: r.p80 ?? 0,
      postsWithoutSignal: r.posts_without_signal ?? 0,
      assessedAt: r.assessed_at,
    };
  } catch (err: any) {
    const errorClass =
      err instanceof CircuitBreakerOpenError
        ? 'CircuitBreakerOpenError'
        : err instanceof RetryExhaustedError
          ? 'RetryExhaustedError'
          : err?.name || 'Error';
    logger.warn(
      {
        component: 'brief-quality-lookup',
        tenantId: args.tenantId,
        clusterKey,
        errorClass,
        errorMessage: err?.message,
      },
      'brief-quality-lookup.lookupBriefQualityForCluster failed; returning null fallback',
    );
    return null;
  }
}

/**
 * Format brief-quality cluster context for LLM prompt augmentation. Returns
 * empty string if cluster is below sample threshold (so caller can skip
 * augmentation cleanly).
 */
export function formatBriefQualityContext(
  cluster: BriefQualityCluster | null,
  minSample: number,
): string {
  if (!cluster) return '';
  if (cluster.count < minSample) return '';
  const meanPct = (cluster.meanRate * 100).toFixed(2);
  const p80Pct = (cluster.p80 * 100).toFixed(2);
  return `Recent posts in this cluster (${cluster.clusterKey}) averaged ${meanPct}% engagement (n=${cluster.count}). Top quartile achieved ${p80Pct}%.`;
}
