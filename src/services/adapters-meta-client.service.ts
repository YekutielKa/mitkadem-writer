import { getEnv } from '../config/env';
import { signServiceToken } from '../lib/jwt';
import { httpPost } from '../lib/http';
import { logger } from '../lib/logger';

/**
 * BLOCK_30 Sprint 4 — thin client for adapters-meta synthetic-default publish.
 *
 * The adapters-meta endpoint (POST /v1/meta/posts/publish) returns:
 *   { externalPostId, publishedAt, mode: 'synthetic'|'real', _stubVersion? }
 *
 * Synthetic-default this sprint: ZERO real Meta Graph API calls (Sprint 4
 * anti-pattern); real-mode за adapters-meta feature flag
 * META_PUBLISH_REAL_MODE_ENABLED — toggle deferred к Sprint 9-10.
 */

export interface PublishPostInput {
  tenantId: string;
  brandPageId: string;
  content: string;
  language?: string;
  platform?: 'instagram' | 'facebook';
}

export interface PublishPostResult {
  externalPostId: string;
  publishedAt: string;
  mode: 'synthetic' | 'real';
  _stubVersion?: string;
}

export async function publishPost(input: PublishPostInput): Promise<PublishPostResult> {
  const env = getEnv();
  const url = `${env.ADAPTERS_META_URL}/v1/meta/posts/publish`;
  const data = await httpPost<PublishPostResult>(
    url,
    {
      tenantId: input.tenantId,
      brandPageId: input.brandPageId,
      content: input.content,
      language: input.language,
      platform: input.platform ?? 'instagram',
    },
    {
      Authorization: `Bearer ${signServiceToken('writer')}`,
    },
    { retries: 1, timeout: 10000 },
  );
  logger.info(
    { tenantId: input.tenantId, externalPostId: data.externalPostId, mode: data.mode },
    '[adapters-meta-client] publishPost ok',
  );
  return data;
}
