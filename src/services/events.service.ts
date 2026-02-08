import { signServiceToken } from '../lib/jwt';
import { getEnv } from '../config/env';
import { logger } from '../lib/logger';

interface EventPayload {
  tenantId: string;
  workflowId: string | null;
  eventType: string;
  source: string;
  value: number;
  meta?: Record<string, unknown>;
}

/**
 * Логирует событие в events service (fire-and-forget)
 */
export async function logEvent(payload: EventPayload): Promise<void> {
  const env = getEnv();
  const url = `${env.EVENTS_URL}/v1/events/log`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signServiceToken()}` },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, 'Events log failed');
    }
  } catch (err: any) {
    logger.warn({ error: err.message }, 'Events log error');
  }
}

/**
 * Применяет reward (fire-and-forget)
 */
export async function applyReward(payload: Record<string, unknown>): Promise<void> {
  const env = getEnv();
  const url = `${env.EVENTS_URL}/v1/rewards/apply`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signServiceToken()}` },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, 'Reward apply failed');
    }
  } catch (err: any) {
    logger.warn({ error: err.message }, 'Reward apply error');
  }
}
