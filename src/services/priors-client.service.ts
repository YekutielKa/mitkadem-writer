/**
 * Priors client — BLOCK_30 Sprint 3 Phase 3.4 stub (Q-WAVE_30.1 (b) Phase B)
 *
 * GET MARKETING_BRAIN_URL/v1/priors thin client wrapper. SERVICE_JWT signed
 * per-tenant query. Sprint 6+ populates brief_priors store; этот stub
 * provides import surface for Sprint 8 creative-style loop 4 wiring.
 */

import { httpGet } from '../lib/http';
import { signServiceToken } from '../lib/jwt';
import { logger } from '../lib/logger';

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
  try {
    const res = await httpGet<GetPriorsResult>(url, headers);
    return res;
  } catch (err: any) {
    logger.warn({
      msg: 'priors-client.getPriors failed',
      tenantId,
      dimension,
      err: err?.message,
    });
    return { priors: [], tenantId, dimension };
  }
}
