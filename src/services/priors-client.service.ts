/**
 * Priors client — BLOCK_30 Sprint 3 Phase 3.4 stub (Q-WAVE_30.1 (b) Phase B);
 * BLOCK_30.7 Sprint 1 reliability hardening (retry + circuit breaker; absorbs
 * Sprint 3 NOTE BLOCK_30.5 carrier).
 *
 * GET MARKETING_BRAIN_URL/v1/priors thin client wrapper. SERVICE_JWT signed
 * per-tenant query. Sprint 6+ populates brief_priors store; Loop 9 producer
 * landed Sprint 2 BLOCK_30.6 (AME-XX-4 architecturally CLOSED). Caller wiring
 * deferred к successor block (writer Path B activation gated behind
 * BRIEF_QUALITY_LOOKUP_ENABLED — Sprint 8 D13.8 halt preserved).
 *
 * Reliability hardening Sprint 1 BLOCK_30.7:
 *  - Exponential backoff retry с jitter (env-tunable max attempts)
 *  - Circuit breaker (CLOSED→OPEN→HALF_OPEN→CLOSED) protects mb during
 *    cascading failures (continuous downtime → continuous fast-fail без
 *    request flooding)
 *  - Graceful fallback к empty `{ priors: [] }` PRESERVED (caller contract)
 *  - SERVICE_JWT auth construction PRESERVED (per-call signing; ZERO caching)
 *  - Token Q-K absolute (NEVER log Authorization header value OR JWT bytes)
 *  - Env-config errors fast-fail OUTSIDE retry wrap (non-transient)
 */

import { httpGet } from '../lib/http';
import { signServiceToken } from '../lib/jwt';
import { logger } from '../lib/logger';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from '../lib/circuit-breaker';
import { retryWithBackoff, RetryExhaustedError } from '../lib/retry';
import { getEnv } from '../config/env';

export type PriorDimension = 'audience' | 'tone' | 'cadence' | 'format' | 'platform';

export interface Prior {
  priorKey: string;
  priorValue: any;
  confidenceScore: number;
  sampleSize: number;
  sourceLoop: string;
  lastUpdatedAt: string;
}

export interface GetPriorsResult {
  priors: Prior[];
  tenantId: string;
  dimension: PriorDimension;
}

const MB_BRAIN_URL = process.env.MARKETING_BRAIN_URL || process.env.MB_BRAIN_URL || '';

let _breaker: CircuitBreaker | null = null;
function getBreaker(): CircuitBreaker {
  if (_breaker) return _breaker;
  const env = getEnv();
  _breaker = new CircuitBreaker(
    {
      failureThreshold: env.PRIORS_CLIENT_BREAKER_FAILURE_THRESHOLD,
      cooldownMs: env.PRIORS_CLIENT_BREAKER_COOLDOWN_SEC * 1000,
    },
    (from, to) => {
      logger.warn(
        { component: 'priors-client', from, to },
        'priors-client.circuit-breaker state transition',
      );
    },
  );
  return _breaker;
}

export async function getPriors(
  tenantId: string,
  dimension: PriorDimension,
  traceId?: string,
): Promise<GetPriorsResult> {
  if (!MB_BRAIN_URL) {
    throw new Error('priors-client: MARKETING_BRAIN_URL / MB_BRAIN_URL env unset');
  }
  const url = `${MB_BRAIN_URL.replace(/\/+$/, '')}/v1/priors?tenantId=${encodeURIComponent(tenantId)}&dimension=${encodeURIComponent(dimension)}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${signServiceToken('writer')}`,
  };
  if (traceId) headers['x-correlation-id'] = traceId;

  const env = getEnv();
  const breaker = getBreaker();

  try {
    return await breaker.execute(() =>
      retryWithBackoff(
        () => httpGet<GetPriorsResult>(url, headers),
        {
          maxAttempts: env.PRIORS_CLIENT_RETRY_MAX_ATTEMPTS,
          baseMs: env.PRIORS_CLIENT_RETRY_BASE_MS,
          maxMs: env.PRIORS_CLIENT_RETRY_MAX_MS,
        },
        (attempt, err) => {
          logger.warn(
            {
              component: 'priors-client',
              tenantId,
              dimension,
              attempt,
              lastErrorMessage: (err as { message?: string } | null)?.message,
            },
            'priors-client.getPriors retry attempt',
          );
        },
      ),
    );
  } catch (err: any) {
    const errorClass =
      err instanceof CircuitBreakerOpenError
        ? 'CircuitBreakerOpenError'
        : err instanceof RetryExhaustedError
          ? 'RetryExhaustedError'
          : err?.name || 'Error';
    logger.warn(
      {
        component: 'priors-client',
        tenantId,
        dimension,
        errorClass,
        errorMessage: err?.message,
      },
      'priors-client.getPriors failed; returning empty fallback',
    );
    return { priors: [], tenantId, dimension };
  }
}
