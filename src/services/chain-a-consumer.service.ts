/**
 * Chain A consumer — BLOCK_30 Sprint 3 Phase 3.3 stub (Q-WAVE_30.1 (b) Phase B)
 *
 * Stub function signatures для chain A picture.updated / drift.detected
 * dispatch consumption. Sprint 8 (creative-style learning loop 4) implements
 * actual logic; this Sprint 3 stub establishes the import surface so
 * downstream wiring can compile in advance.
 *
 * NOT route-mounted этот sprint — insights forwarder dispatches к mb
 * /v1/chain-a/notify endpoint (Sprint 4-5 routes events further); writer-side
 * consumption surface activates Sprint 8 + creative-style loop scope expansion.
 */

import { logger } from '../lib/logger';

export interface ChainAEventEnvelope {
  eventId: string;
  tenantId: string;
  eventType: 'picture.updated' | 'drift.detected';
  payload: any;
  eventAt: string;
}

export interface ChainAConsumerAck {
  acknowledged: true;
  _stub: 'BLOCK_30/Sprint_3/Phase_3.3';
  _next_implementation: 'Sprint_8_creative_style_loop_4';
}

export async function onPictureUpdated(envelope: ChainAEventEnvelope): Promise<ChainAConsumerAck> {
  logger.info({
    msg: 'chain-a-consumer.onPictureUpdated stub',
    eventId: envelope.eventId,
    tenantId: envelope.tenantId,
    eventAt: envelope.eventAt,
  });
  return {
    acknowledged: true,
    _stub: 'BLOCK_30/Sprint_3/Phase_3.3',
    _next_implementation: 'Sprint_8_creative_style_loop_4',
  };
}

export async function onDriftDetected(envelope: ChainAEventEnvelope): Promise<ChainAConsumerAck> {
  logger.info({
    msg: 'chain-a-consumer.onDriftDetected stub',
    eventId: envelope.eventId,
    tenantId: envelope.tenantId,
    eventAt: envelope.eventAt,
  });
  return {
    acknowledged: true,
    _stub: 'BLOCK_30/Sprint_3/Phase_3.3',
    _next_implementation: 'Sprint_8_creative_style_loop_4',
  };
}
