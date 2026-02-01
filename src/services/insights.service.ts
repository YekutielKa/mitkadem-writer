import { getEnv } from '../config/env';
import { signServiceToken } from '../lib/jwt';
import { httpPost, httpGet } from '../lib/http';
import { logger } from '../lib/logger';
import { WriterHints, FeedbackInput } from '../types/writer';

/**
 * Получает hints от insights для улучшения генерации
 */
export async function getHints(tenantId: string): Promise<WriterHints> {
  const env = getEnv();
  const url = `${env.INSIGHTS_URL}/v1/insights/hints/writer?tenantId=${tenantId}`;

  try {
    const data = await httpGet<{ hints: WriterHints }>(url, {
      Authorization: `Bearer ${signServiceToken()}`,
    });
    return data.hints || {};
  } catch (err: any) {
    logger.warn({ tenantId, error: err.message }, 'Failed to get hints from insights');
    return {};
  }
}

interface FeedbackResponse {
  ok: boolean;
  [key: string]: unknown;
}

/**
 * Отправляет feedback в insights
 */
export async function sendFeedback(input: FeedbackInput): Promise<FeedbackResponse> {
  const env = getEnv();

  // 1. Send to metrics/feedback
  const feedbackUrl = `${env.INSIGHTS_URL}/v1/metrics/feedback`;
  const feedbackData = await httpPost<FeedbackResponse>(
    feedbackUrl,
    {
      generationId: input.contentId,
      tenantId: input.tenantId,
      action: input.feedbackType,
      contentPreview: input.originalContent?.slice(0, 200),
      editedContent: input.editedContent,
      rejectionReason: input.rejectionReason,
      originalContent: input.originalContent,
      sourceService: 'writer',
    },
    {
      Authorization: `Bearer ${signServiceToken()}`,
    }
  );

  // 2. Send learning event
  const learningUrl = `${env.INSIGHTS_URL}/v1/insights/learning-event`;
  try {
    await httpPost(
      learningUrl,
      {
        tenantId: input.tenantId,
        eventType: 'feedback_received',
        service: 'writer',
        data: {
          contentId: input.contentId,
          feedbackType: input.feedbackType,
          score: input.score,
          hasEdit: !!input.editedContent,
        },
      },
      {
        Authorization: `Bearer ${signServiceToken()}`,
      }
    );
  } catch (err: any) {
    logger.warn({ error: err.message }, 'Failed to send learning event');
  }

  return feedbackData;
}
